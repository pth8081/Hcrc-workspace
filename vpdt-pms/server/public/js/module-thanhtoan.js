// ==========================================
// MODULE CON "THANH TOÁN" (module "Tổng Hợp") — tổng hợp đề nghị thanh toán tự sinh từ Hợp đồng/Mua
// Bán/Sửa Chữa/Đầu Tư (bấm "Chuyển Sang Thanh Toán") lẫn tạo thủ công. Vòng đời DRAFT (lập/đính kèm Hồ
// Sơ Đề Nghị Thanh Toán) -> PENDING (sửa được) -> [NEED_INFO (sửa được)] -> APPROVED (xác nhận từng đợt,
// không còn cần tệp) -> PAID (khoá cứng) — xem lib/recordActions.js.
// ==========================================
let editingPaymentRequestId = null;
// Đề nghị (DRAFT) đang mở sẵn khối sửa đợt thanh toán inline ở sub-tab "🗂️ Quản Lý Thanh Toán" — chỉ 1
// đề nghị mở cùng lúc (khớp UX openEditPaymentRequest() ở tab "➕ Tạo Mới" cũng chỉ sửa 1 đề nghị/lần).
let managePaymentExpandedId = null;
// Lọc "🗂️ Quản Lý Thanh Toán" theo hồ sơ nguồn (mã hợp đồng/Mua Bán/Sửa Chữa) — '' = tất cả.
let managePaymentFilterSource = '';

// canManagePaymentRequestsClient() da chuyen sang core.js (Ha tang: nap module theo cum, dot 7) -
// getMyPendingApprovals() (core-approvalhub.js, luon nap san) goi thang ham nay o MOI switchTab().

function setPaymentSubTab(subTab) {
  window.scrollTo({ top: 0, behavior: 'auto' }); // Tránh "bay xuống cuối" khi đổi tab con — xem setSystemSubTab().
  activePaymentSubTab = subTab;
  const activeCls = 'px-3 py-1 rounded text-xs font-bold bg-amber-700 text-white';
  const inactiveCls = 'px-3 py-1 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnPaymentSubCreate').className = subTab === 'CREATE' ? activeCls : inactiveCls;
  document.getElementById('btnPaymentSubManage').className = subTab === 'MANAGE' ? activeCls : inactiveCls;
  document.getElementById('btnPaymentSubApprove').className = subTab === 'APPROVE' ? activeCls : inactiveCls;
  document.getElementById('paymentCreateWrap').classList.toggle('hidden', subTab !== 'CREATE');
  document.getElementById('paymentManageWrap').classList.toggle('hidden', subTab !== 'MANAGE');
  document.getElementById('paymentApproveWrap').classList.toggle('hidden', subTab !== 'APPROVE');
  if (subTab === 'CREATE' && editingPaymentRequestId === null) cancelEditPaymentRequest();
  if (subTab === 'MANAGE') renderPaymentManageTab();
  else renderPaymentRequests();
}

function renderPaymentCreateInstallmentsList(installments) {
  const container = document.getElementById('paymentCreateInstallmentsList');
  if (!container) return;
  container.innerHTML = (installments || []).map((it, idx) => `
    <div class="flex gap-2 items-center" data-installment-row="${idx}">
      <input placeholder="Mô tả đợt (VD: Đợt 1)" value="${escapeHtml(it.description || '')}" class="flex-1 border p-1.5 rounded payment-installment-desc">
      <input type="text" inputmode="numeric" placeholder="Số tiền (VNĐ)" value="${formatMoneyDisplay(it.amount)}" class="w-40 border p-1.5 rounded payment-installment-amount money-input">
      <input type="date" value="${it.dueDate || ''}" class="w-40 border p-1.5 rounded payment-installment-due">
      <button type="button" data-op="removePaymentCreateInstallmentRow" data-arg0="${idx}" class="text-red-500 font-bold hover:underline px-1">✕</button>
    </div>
  `).join('') || '<p class="text-gray-400 italic text-[11px]">Chưa có đợt thanh toán nào — bấm "+ Thêm Đợt".</p>';
  updatePaymentCreateInstallmentsSummary();
}
function addPaymentCreateInstallmentRow() {
  const current = collectPaymentCreateInstallments();
  current.push({ description: '', amount: '', dueDate: '' });
  renderPaymentCreateInstallmentsList(current);
}
function removePaymentCreateInstallmentRow(idx) {
  const current = collectPaymentCreateInstallments();
  current.splice(idx, 1);
  renderPaymentCreateInstallmentsList(current);
}
function collectPaymentCreateInstallments() {
  return [...document.querySelectorAll('#paymentCreateInstallmentsList [data-installment-row]')].map(row => ({
    description: row.querySelector('.payment-installment-desc').value.trim(),
    amount: getMoneyValue(row.querySelector('.payment-installment-amount')),
    dueDate: row.querySelector('.payment-installment-due').value
  }));
}

// Cảnh báo LIVE khi tổng các đợt đang khai lệch giá trị hồ sơ nguồn (Hợp đồng/Mua Bán/Sửa Chữa) — server
// (startContractPayment()/startOfficePayment(), lib/recordActions.js) CỐ Ý không chặn việc khai khác giá
// trị tham khảo (kế toán có thể cần thanh toán từng phần/khác giá trị gốc), nhưng phải cảnh báo rõ ràng
// để người tạo/duyệt biết mình đang lệch bao nhiêu trước khi gửi — không chặn submit, chỉ hiển thị.
function updatePaymentCreateInstallmentsSummary() {
  const box = document.getElementById('paymentCreateInstallmentsSummary');
  if (!box) return;
  const sourceType = document.getElementById('paymentSourceType')?.value;
  if (!sourceType || sourceType === 'MANUAL') { box.innerHTML = ''; return; }
  const sourceId = Number(document.getElementById('paymentSourceRecord')?.value);
  if (!sourceId) { box.innerHTML = ''; return; }
  const record = (sourceType === 'CONTRACT' ? DB.contracts : DB.officeReqs).find(r => r.id === sourceId);
  if (!record) { box.innerHTML = ''; return; }
  const total = collectPaymentCreateInstallments().reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const reference = record.amount || 0;
  if (Math.abs(total - reference) <= 1) {
    box.innerHTML = `<span class="text-gray-500">Tổng các đợt: ${total.toLocaleString('vi-VN')} VNĐ — khớp giá trị hồ sơ nguồn.</span>`;
  } else {
    box.innerHTML = `<span class="text-red-600 font-bold">⚠️ Tổng các đợt (${total.toLocaleString('vi-VN')} VNĐ) lệch giá trị hồ sơ nguồn (${reference.toLocaleString('vi-VN')} VNĐ) — vẫn gửi được, nhưng người duyệt sẽ thấy cảnh báo này.</span>`;
  }
}

// "Loại Đề Nghị" (sourceType) — chọn Hợp Đồng/Mua Sắm/Sửa Chữa/Đầu Tư thì đổi sang tạo đề nghị thanh
// toán CÓ NGUỒN (POST /api/records/paymentRequests/from-source), khớp yêu cầu "chọn được trạng thái
// loại đề nghị ... để làm thanh toán theo đúng mã". Chỉ liệt kê hồ sơ nguồn CÒN CHƯA THANH TOÁN (đã có
// Tài liệu ký được duyệt) — khớp "chỉ trạng thái nào chưa thanh toán mới được làm đề nghị thanh toán".
function populatePaymentSourceRecordOptions() {
  const sourceType = document.getElementById('paymentSourceType').value;
  const sel = document.getElementById('paymentSourceRecord');
  if (sourceType === 'MANUAL') {
    sel.innerHTML = '';
    return;
  }
  // Hợp đồng đòi hỏi Tài liệu ký đã DUYỆT XONG (signedFileStatus APPROVED, khớp startContractPayment()
  // ở lib/recordActions.js); đề xuất Tổng Hợp (Mua Bán/Sửa Chữa/Đầu Tư) chỉ cần ĐÃ TẢI LÊN (signedFileUrl,
  // khớp startOfficePayment() — module này không có bước duyệt riêng cho Tài liệu ký) — 2 điều kiện khác
  // nhau tuỳ nguồn, giữ đúng logic gốc.
  const unpaid = sourceType === 'CONTRACT'
    ? DB.contracts.filter(c => c.paymentStatus === 'CHUA_THANH_TOAN')
    : DB.officeReqs.filter(o => o.subType === sourceType && o.paymentStatus === 'CHUA_THANH_TOAN');
  const isReady = r => sourceType === 'CONTRACT' ? (r.signedFileUrl && r.signedFileStatus === 'APPROVED') : !!r.signedFileUrl;
  const eligible = unpaid.filter(isReady);
  // Hồ sơ chưa thanh toán nhưng CHƯA đủ điều kiện — liệt kê riêng dạng disabled để người dùng hiểu vì
  // sao không thấy trong danh sách chọn được, thay vì tưởng bị lỗi.
  const notReady = unpaid.filter(r => !isReady(r));
  const notReadyHint = sourceType === 'CONTRACT' ? 'thiếu/chưa duyệt Tài liệu ký' : 'thiếu Tài liệu ký';
  sel.innerHTML = '<option value="">-- Chọn hồ sơ --</option>' +
    eligible.map(r => `<option value="${r.id}">${escapeHtml(r.code)} — ${escapeHtml(r.title)}</option>`).join('') +
    (notReady.length ? `<option value="" disabled>── Chưa đủ điều kiện (${notReadyHint}) ──</option>` +
      notReady.map(r => `<option value="" disabled>${escapeHtml(r.code)} — ${escapeHtml(r.title)}</option>`).join('') : '');
}

// Tham khảo đợt thanh toán từ nguồn — khớp buildPaymentInstallments() ở lib/recordActions.js: Hợp đồng
// dùng nguyên paymentInstallments đã khai (nếu có), còn lại (Mua Sắm/Sửa Chữa/Đầu Tư không có form khai
// nhiều đợt) mặc định 1 đợt = toàn bộ giá trị. Vẫn SỬA ĐƯỢC tự do trước khi gửi (yêu cầu "thay đổi bằng
// đề nghị thanh toán nếu có thay đổi").
function computeSourcePaymentInstallmentsPreview(record) {
  const list = Array.isArray(record.paymentInstallments) ? record.paymentInstallments : [];
  if (list.length) return list.map(it => ({ description: it.description || '', amount: it.amount || 0, dueDate: it.dueDate || '' }));
  return [{ description: 'Thanh toán toàn bộ giá trị', amount: record.amount || 0, dueDate: '' }];
}

function onPaymentSourceTypeChange() {
  const sourceType = document.getElementById('paymentSourceType').value;
  document.getElementById('paymentSourceRecordWrap').classList.toggle('hidden', sourceType === 'MANUAL');
  // dept do server tự gán theo đơn vị custodian/nguồn khi có sourceType (xem startContractPayment()/
  // startOfficePayment() ở lib/recordActions.js) — ẩn hẳn ô Phòng Ban để không gây hiểu nhầm là chọn
  // được, chỉ hiện lại đúng lúc Thủ công (server dùng nguyên giá trị người dùng chọn).
  document.getElementById('paymentDeptWrap').classList.toggle('hidden', sourceType !== 'MANUAL');
  // required chỉ đúng khi có nguồn (CONTRACT/MUA_BAN/SUA_CHUA) — hardcode required trong HTML gốc bỏ
  // sót trường hợp Thủ công: select bị ẩn (display:none qua wrap ở trên) NHƯNG vẫn còn required=true
  // khiến Chrome chặn ÂM THẦM toàn bộ submit (không focus được ô ẩn để báo lỗi, không log gì ngoài 1
  // dòng console warning) — bug có thật, chặn đứng cả luồng tạo đề nghị Thủ công, không liên quan CSP.
  document.getElementById('paymentSourceRecord').required = sourceType !== 'MANUAL';
  populatePaymentSourceRecordOptions();
  document.getElementById('paymentSourceRecord').value = '';
  document.getElementById('paymentTitle').value = '';
  renderPaymentCreateInstallmentsList([]);
}

function onPaymentSourceRecordChange() {
  const sourceType = document.getElementById('paymentSourceType').value;
  const id = Number(document.getElementById('paymentSourceRecord').value);
  if (sourceType === 'MANUAL' || !id) return;
  const record = (sourceType === 'CONTRACT' ? DB.contracts : DB.officeReqs).find(r => r.id === id);
  if (!record) return;
  document.getElementById('paymentTitle').value = record.title;
  renderPaymentCreateInstallmentsList(computeSourcePaymentInstallmentsPreview(record));
}

async function submitManualPaymentRequest(e) {
  e.preventDefault();
  const sourceType = editingPaymentRequestId === null ? document.getElementById('paymentSourceType').value : 'MANUAL';
  const sourceId = sourceType !== 'MANUAL' ? Number(document.getElementById('paymentSourceRecord').value) : null;
  if (sourceType !== 'MANUAL' && !sourceId) return alert('Vui lòng chọn hồ sơ nguồn!');
  const dept = document.getElementById('paymentDept').value;
  const title = document.getElementById('paymentTitle').value.trim();
  const installments = collectPaymentCreateInstallments();
  if (!installments.length) return alert('Vui lòng thêm ít nhất 1 đợt thanh toán!');

  if (editingPaymentRequestId !== null) {
    let updated;
    try {
      const result = await callRecordAction('paymentRequests', editingPaymentRequestId, 'edit', { title, dept, installments });
      updated = result.item;
    } catch (err) {
      return alert(`⛔ ${err.message}`);
    }
    const idx = DB.paymentRequests.findIndex(x => x.id === editingPaymentRequestId);
    if (idx !== -1) DB.paymentRequests[idx] = updated;
    logSystemAction('OFFICE', 'EDIT_PAYMENT_REQUEST', `Cập nhật đề nghị thanh toán [${updated.title}]`, 'SUCCESS', String(updated.id));
    alert('✅ Đã cập nhật đề nghị thanh toán!');
    cancelEditPaymentRequest();
    setPaymentSubTab('APPROVE');
    return;
  }

  // "Hồ Sơ Đề Nghị Thanh Toán" — TUỲ CHỌN ngay lúc tạo (có thể đính kèm sau ở "🗂️ Quản Lý Thanh Toán"),
  // upload ngay nếu người dùng đã chọn tệp trong form tạo.
  const createFilesInput = document.getElementById('paymentCreateRequestFiles');
  const chosenCreateFiles = createFilesInput && createFilesInput.files ? Array.from(createFilesInput.files) : [];
  let requestFiles = [];
  if (chosenCreateFiles.length) {
    try {
      const uploaded = await Promise.all(chosenCreateFiles.map(f => uploadFileToServer(f, 'payment')));
      requestFiles = uploaded.map(u => ({ fileUrl: u.fileUrl, fileName: u.fileName, fileType: u.fileType }));
    } catch (err) {
      return alert(`⛔ Tải tệp lên thất bại: ${err.message}`);
    }
  }

  let newPr;
  let updatedSourceItem = null;
  try {
    if (sourceType === 'MANUAL') {
      const result = await callCreateAction('paymentRequests', { dept, title, installments, requestFiles });
      newPr = result.item;
    } else {
      const result = await callCreatePaymentRequestFromSource({ sourceModule: sourceType, sourceId, title, installments, requestFiles });
      newPr = result.paymentRequest;
      updatedSourceItem = result.item;
    }
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  DB.paymentRequests.unshift(newPr);
  if (updatedSourceItem) {
    const coll = sourceType === 'CONTRACT' ? DB.contracts : DB.officeReqs;
    const idx = coll.findIndex(x => x.id === updatedSourceItem.id);
    if (idx !== -1) coll[idx] = updatedSourceItem;
    renderContracts();
    renderOfficeReqs();
  }
  logSystemAction('OFFICE', 'CREATE_PAYMENT_REQUEST', `Lập nháp đề nghị thanh toán ${sourceType === 'MANUAL' ? 'thủ công' : `từ nguồn [${PAYMENT_SOURCE_LABELS[sourceType] || sourceType}]`} [${title}]`, 'SUCCESS', String(newPr.id));
  alert('✅ Đã lập đề nghị thanh toán (nháp) — vào "🗂️ Quản Lý Thanh Toán" để đính kèm đủ Hồ Sơ Đề Nghị Thanh Toán rồi "Chuyển Xác Nhận Thanh Toán".');
  cancelEditPaymentRequest();
  managePaymentExpandedId = newPr.id;
  setPaymentSubTab('MANAGE');
}

// resetPaymentCreateForm() — nút "↺ Làm Mới" (khớp mẫu resetXxxForm dùng chung mọi form tạo mới, xem
// CLAUDE.md/core.js confirmAndResetForm()) — tái dùng NGUYÊN cancelEditPaymentRequest() đã có sẵn đủ
// logic dọn trạng thái JS (loại đề nghị về Thủ công, xoá các đợt thanh toán đã khai, nhãn nút gửi),
// không viết lại. Bấm "Làm Mới" khi đang SỬA 1 đề nghị dở dang cũng huỷ luôn thao tác sửa đó — đúng ý
// muốn "làm mới hẳn form", không phải chỉ xoá phần chưa lưu.
function resetPaymentCreateForm() {
  cancelEditPaymentRequest();
}

function cancelEditPaymentRequest() {
  editingPaymentRequestId = null;
  const form = document.getElementById('paymentCreateForm');
  form.reset();
  document.getElementById('paymentSourceTypeWrap').classList.remove('hidden');
  document.getElementById('paymentSourceType').value = 'MANUAL';
  onPaymentSourceTypeChange();
  document.getElementById('paymentCreateRequestFilesWrap').classList.remove('hidden');
  clearMultiFileInput('paymentCreateRequestFiles', 'paymentCreateRequestFilesChips');
  form.querySelector('button[type="submit"]').innerText = 'Lập Đề Nghị (Nháp)';
}

function openEditPaymentRequest(id) {
  const pr = DB.paymentRequests.find(x => x.id === id);
  if (!pr) return;
  editingPaymentRequestId = id;
  setPaymentSubTab('CREATE');
  // Sửa đề nghị đã tạo (kể cả đề nghị có nguồn) chỉ đổi title/dept/amount/installments qua
  // editPaymentRequest() — KHÔNG đổi lại nguồn (sourceModule/sourceId cố định từ lúc tạo) nên ẩn hẳn bộ
  // chọn Loại Đề Nghị/Hồ Sơ Nguồn khi đang sửa, tránh gây hiểu nhầm là đổi được nguồn.
  document.getElementById('paymentSourceTypeWrap').classList.add('hidden');
  document.getElementById('paymentSourceRecordWrap').classList.add('hidden');
  document.getElementById('paymentSourceRecord').required = false; // ẩn hẳn ở chế độ sửa — xem chú thích required trong onPaymentSourceTypeChange()
  // "Hồ Sơ Đề Nghị Thanh Toán" chỉ đính kèm được lúc TẠO hoặc ở "🗂️ Quản Lý Thanh Toán" (còn NHÁP) —
  // form Sửa này chỉ đổi title/dept/installments (editPaymentRequest() không nhận requestFiles từ đây),
  // ẩn hẳn để không gây hiểu nhầm chọn tệp ở đây rồi mất vì không được gửi đi.
  document.getElementById('paymentCreateRequestFilesWrap').classList.add('hidden');
  document.getElementById('paymentDeptWrap').classList.remove('hidden');
  document.getElementById('paymentDept').value = pr.dept;
  document.getElementById('paymentTitle').value = pr.title;
  renderPaymentCreateInstallmentsList(pr.installments || []);
  document.getElementById('paymentCreateForm').querySelector('button[type="submit"]').innerText = '💾 Cập Nhật Đề Nghị Thanh Toán';
  document.getElementById('paymentCreateForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// DRAFT — MỚI (sub-tab "🗂️ Quản Lý Thanh Toán"): đề nghị vừa "🧾 Lập Thanh Toán" (module Hợp Đồng) hoặc
// đang tự lập/sửa đợt, CHƯA gửi duyệt (số tiền từng đợt CHƯA bắt buộc).
const PAYMENT_STATUS_LABELS = { DRAFT: '📝 Nháp — chưa gửi duyệt', PENDING: '⏳ Chờ duyệt', NEED_INFO: '📝 Cần bổ sung', APPROVED: '✅ Đã duyệt (chờ xác nhận)', PAID: '💰 Đã thanh toán' };
const PAYMENT_STATUS_BADGE_CLS = { DRAFT: 'bg-gray-200 text-gray-700', PENDING: 'bg-amber-100 text-amber-800', NEED_INFO: 'bg-orange-100 text-orange-800', APPROVED: 'bg-blue-100 text-blue-800', PAID: 'bg-green-100 text-green-800' };
const PAYMENT_SOURCE_LABELS = { CONTRACT: '📄 Hợp đồng', MUA_BAN: '🛒 Mua Bán', SUA_CHUA: '🔧 Sửa Chữa', MANUAL: '✍️ Thủ công' };

function onPaymentFilterChange() {
  renderPaymentRequests();
}

function filterPaymentByCard(status) {
  applyDashboardCardFilter({ filterStatusPayment: status }, null, renderPaymentRequests);
}

// ========== "🗂️ Quản Lý Thanh Toán" (sub-tab MỚI) ==========
// Trạng thái cảnh báo hạn thanh toán 1 ĐỢT — bản sao client-side của
// computePaymentInstallmentDeadlineStatus() ở lib/recordActions.js (LƯU Ý BẢO TRÌ: sửa 1 bên phải sửa
// cả 2 bên, cùng khuôn computeOperationWorkItemDeadlineStatus() ở module-vanhanh.js).
function computePaymentInstallmentDeadlineStatusClient(installment) {
  if (!installment) return 'KHONG_CO_HAN';
  if (installment.confirmed) return 'DA_THANH_TOAN';
  if (!installment.dueDate) return 'KHONG_CO_HAN';
  const m = String(installment.dueDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 'KHONG_CO_HAN';
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(due.getTime())) return 'KHONG_CO_HAN';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return 'QUA_HAN';
  if (diffDays <= 3) return 'SAP_DEN_HAN';
  return 'DUNG_HAN';
}
const PAYMENT_INSTALLMENT_DEADLINE_BADGE = {
  QUA_HAN: '<span class="inline-block px-1.5 py-0.5 bg-red-100 text-red-800 rounded font-bold text-[10px]">🔴 Quá hạn</span>',
  SAP_DEN_HAN: '<span class="inline-block px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-[10px]">🟡 Sắp đến hạn</span>'
};
function paymentInstallmentDeadlineBadge(installment) {
  if (installment?.confirmed) return '<span class="inline-block px-1.5 py-0.5 bg-green-100 text-green-800 rounded font-bold text-[10px]">✅ Đã thanh toán</span>';
  return PAYMENT_INSTALLMENT_DEADLINE_BADGE[computePaymentInstallmentDeadlineStatusClient(installment)] || '';
}

// Trạng thái TỔNG HỢP ("tổng đợt") của 1 đề nghị — bản sao client-side của
// computePaymentRequestOverallStatus() ở lib/recordActions.js (LƯU Ý BẢO TRÌ: sửa 1 bên phải sửa cả 2
// bên) — dùng cho badge tổng + cảnh báo tổng hợp (yêu cầu nghiệp vụ #1 + #5).
function computePaymentRequestOverallStatusClient(pr) {
  if (!pr) return 'DANG_THANH_TOAN';
  if (pr.status === 'PAID') return 'DA_THANH_TOAN';
  const installments = Array.isArray(pr.installments) ? pr.installments : [];
  const hasOverdue = installments.some(it => computePaymentInstallmentDeadlineStatusClient(it) === 'QUA_HAN');
  return hasOverdue ? 'QUA_HAN' : 'DANG_THANH_TOAN';
}
const PAYMENT_OVERALL_STATUS_LABELS = { QUA_HAN: '🔴 Tổng đợt: Quá hạn', DANG_THANH_TOAN: '🟡 Tổng đợt: Đang thanh toán', DA_THANH_TOAN: '✅ Tổng đợt: Đã thanh toán' };
const PAYMENT_OVERALL_STATUS_BADGE_CLS = { QUA_HAN: 'bg-red-100 text-red-800', DANG_THANH_TOAN: 'bg-amber-100 text-amber-800', DA_THANH_TOAN: 'bg-green-100 text-green-800' };
function paymentOverallStatusBadge(pr) {
  const s = computePaymentRequestOverallStatusClient(pr);
  return `<span class="inline-block px-1.5 py-0.5 rounded font-bold text-[10px] ${PAYMENT_OVERALL_STATUS_BADGE_CLS[s] || ''}">${PAYMENT_OVERALL_STATUS_LABELS[s] || s}</span>`;
}

// Đếm số đợt quá hạn/sắp đến hạn của 1 đề nghị — bản sao client-side của countPaymentInstallmentWarnings()
// ở lib/recordActions.js (LƯU Ý BẢO TRÌ: sửa 1 bên phải sửa cả 2 bên) — dùng cho cảnh báo tổng hợp
// "N đợt quá hạn/sắp đến hạn" (yêu cầu nghiệp vụ #5).
function countPaymentInstallmentWarningsClient(pr) {
  const installments = Array.isArray(pr?.installments) ? pr.installments : [];
  let overdueCount = 0, nearDueCount = 0;
  installments.forEach(it => {
    const s = computePaymentInstallmentDeadlineStatusClient(it);
    if (s === 'QUA_HAN') overdueCount++;
    else if (s === 'SAP_DEN_HAN') nearDueCount++;
  });
  return { overdueCount, nearDueCount };
}
function paymentWarningCountsHTML(pr) {
  const { overdueCount, nearDueCount } = countPaymentInstallmentWarningsClient(pr);
  if (!overdueCount && !nearDueCount) return '';
  const parts = [];
  if (overdueCount) parts.push(`<span class="text-red-600 font-bold">🔴 ${overdueCount} đợt quá hạn</span>`);
  if (nearDueCount) parts.push(`<span class="text-amber-600 font-bold">🟡 ${nearDueCount} đợt sắp đến hạn</span>`);
  return `<div class="text-[11px] mt-0.5">${parts.join(' — ')}</div>`;
}

// Nguồn (mã hồ sơ) khả dụng để lọc — chỉ liệt kê nguồn của các đề nghị đang hiện trong tab này.
function populatePaymentManageFilterOptions(list) {
  const sel = document.getElementById('paymentManageFilterSource');
  if (!sel) return;
  const codes = [...new Set(list.map(pr => pr.sourceCode).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">-- Tất cả hồ sơ nguồn --</option>' +
    codes.map(code => `<option value="${escapeHtml(code)}" ${managePaymentFilterSource === code ? 'selected' : ''}>${escapeHtml(code)}</option>`).join('');
}
function onPaymentManageFilterChange() {
  managePaymentFilterSource = document.getElementById('paymentManageFilterSource')?.value || '';
  renderPaymentManageTab();
}

function renderPaymentManageInstallmentsList(prId, installments) {
  const container = document.getElementById(`paymentManageInstallmentsList_${prId}`);
  if (!container) return;
  container.innerHTML = (installments || []).map((it, idx) => `
    <div class="flex gap-2 items-center" data-installment-row="${idx}">
      <input placeholder="Mô tả đợt (VD: Đợt 1)" value="${escapeHtml(it.description || '')}" class="flex-1 border p-1.5 rounded payment-installment-desc">
      <input type="text" inputmode="numeric" placeholder="Số tiền (VNĐ) — có thể để trống" value="${it.amount != null ? formatMoneyDisplay(it.amount) : ''}" class="w-48 border p-1.5 rounded payment-installment-amount money-input">
      <input type="date" value="${it.dueDate || ''}" class="w-40 border p-1.5 rounded payment-installment-due">
      <button type="button" data-op="removePaymentManageInstallmentRow" data-arg0="${prId}" data-arg1="${idx}" class="text-red-500 font-bold hover:underline px-1">✕</button>
    </div>
  `).join('') || '<p class="text-gray-400 italic text-[11px]">Chưa có đợt thanh toán nào — bấm "+ Thêm Đợt".</p>';
}
function collectPaymentManageInstallments(prId) {
  return [...document.querySelectorAll(`#paymentManageInstallmentsList_${prId} [data-installment-row]`)].map(row => ({
    description: row.querySelector('.payment-installment-desc').value.trim(),
    amount: getMoneyValue(row.querySelector('.payment-installment-amount')) || null,
    dueDate: row.querySelector('.payment-installment-due').value
  }));
}
function addPaymentManageInstallmentRow(prId) {
  const current = collectPaymentManageInstallments(prId);
  current.push({ description: '', amount: null, dueDate: '' });
  renderPaymentManageInstallmentsList(prId, current);
}
function removePaymentManageInstallmentRow(prId, idx) {
  const current = collectPaymentManageInstallments(prId);
  current.splice(idx, 1);
  renderPaymentManageInstallmentsList(prId, current);
}

function openPaymentManageEdit(id) {
  managePaymentExpandedId = id;
  renderPaymentManageTab();
}
function closePaymentManageEdit() {
  managePaymentExpandedId = null;
  renderPaymentManageTab();
}

// Đọc tệp MỚI vừa chọn ở input "Hồ Sơ Đề Nghị Thanh Toán" của 1 đề nghị (nếu có), upload lên server rồi
// GỘP với danh sách đã có sẵn (pr.requestFiles) — KHÔNG cho gỡ tệp đã đính kèm trước đó ở đây (chỉ thêm
// mới), giữ đơn giản đúng nhu cầu "đính kèm nhiều tệp trước khi gửi". Input có thể không tồn tại trong
// DOM nếu khối sửa NHÁP đang đóng (managePaymentExpandedId khác id) — khi đó trả nguyên requestFiles cũ.
async function collectAndUploadPaymentManageRequestFiles(id) {
  const pr = DB.paymentRequests.find(x => x.id === id);
  const existing = (pr && Array.isArray(pr.requestFiles)) ? pr.requestFiles : [];
  const input = document.getElementById(`paymentManageRequestFilesInput_${id}`);
  const newFiles = input && input.files ? Array.from(input.files) : [];
  if (!newFiles.length) return existing;
  const uploaded = await Promise.all(newFiles.map(f => uploadFileToServer(f, 'payment')));
  return existing.concat(uploaded.map(u => ({ fileUrl: u.fileUrl, fileName: u.fileName, fileType: u.fileType })));
}

// "💾 Lưu" — LƯU đợt thanh toán đang lập/sửa, GIỮ NGUYÊN trạng thái NHÁP (số tiền để trống vẫn lưu được
// — quyết định nghiệp vụ đã chốt: chỉ bắt buộc số tiền lúc "Chuyển Xác Nhận Thanh Toán"). Kèm luôn upload
// + gộp "Hồ Sơ Đề Nghị Thanh Toán" mới chọn (nếu có) — không bắt buộc lúc Lưu, chỉ bắt buộc lúc Gửi.
async function savePaymentManageDraft(id) {
  const pr = DB.paymentRequests.find(x => x.id === id);
  if (!pr) return;
  const installments = collectPaymentManageInstallments(id);
  if (!installments.length) return alert('⛔ Vui lòng thêm ít nhất 1 đợt thanh toán!');
  let requestFiles;
  try {
    requestFiles = await collectAndUploadPaymentManageRequestFiles(id);
  } catch (err) { return alert(`⛔ Tải tệp lên thất bại: ${err.message}`); }
  let updated;
  try {
    const result = await callRecordAction('paymentRequests', id, 'edit', { installments, requestFiles });
    updated = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.paymentRequests.findIndex(x => x.id === id);
  if (idx !== -1) DB.paymentRequests[idx] = updated;
  logSystemAction('OFFICE', 'SAVE_PAYMENT_DRAFT', `Lưu nháp đề nghị thanh toán [${updated.title}]`, 'SUCCESS', String(updated.id));
  alert('✅ Đã lưu nháp — chưa gửi duyệt.');
  renderPaymentManageTab();
}

// "📨 Chuyển Xác Nhận Thanh Toán" (DRAFT -> PENDING) — kiểm tra CLIENT trước (mirror đúng luật server:
// mọi đợt phải có số tiền > 0) để báo lỗi rõ ràng NGAY, không cần round-trip; server (submitPaymentRequest(),
// lib/recordActions.js) vẫn tự kiểm tra lại 400 nếu có ai bỏ qua bước này (DevTools/API trực tiếp).
function submitPaymentRequestAction(id) {
  const pr = DB.paymentRequests.find(x => x.id === id);
  if (!pr) return;
  // Nếu đang mở khối sửa của ĐÚNG đề nghị này thì lấy nguyên trạng ĐANG GÕ DỞ trên form (chưa lưu) để
  // kiểm tra ngay, không bắt người dùng phải bấm "Lưu" trước rồi mới "Chuyển Xác Nhận Thanh Toán".
  const installments = managePaymentExpandedId === id ? collectPaymentManageInstallments(id) : (pr.installments || []);
  if (!installments.length) return alert('⛔ Cần ít nhất 1 đợt thanh toán trước khi chuyển xác nhận thanh toán!');
  const missing = installments.map((it, i) => (Number(it.amount) > 0 ? null : i + 1)).filter(n => n !== null);
  if (missing.length) {
    return alert(`⛔ Vui lòng nhập số tiền lớn hơn 0 cho đợt thanh toán số: ${missing.join(', ')} trước khi chuyển xác nhận thanh toán!`);
  }
  const contract = pr.sourceModule === 'CONTRACT' ? DB.contracts.find(c => c.id === pr.sourceId) : null;
  const isOneTime = !contract || contract.paymentType !== 'PERIODIC';
  const warnHTML = isOneTime
    ? `<br><span class="text-xs text-amber-700">⚠️ Hợp đồng "Thanh toán 1 lần" — sau khi gửi duyệt sẽ KHÔNG thể thêm đợt thanh toán mới nữa. Bạn có chắc đã nhập đủ các đợt thanh toán?</span>`
    : '';
  showConfirmModal({
    title: 'Chuyển xác nhận thanh toán',
    bodyHTML: `Chuyển đề nghị "<b>${escapeHtml(pr.title)}</b>" sang chờ duyệt theo phòng ban?${warnHTML}`,
    confirmLabel: 'Chuyển Xác Nhận',
    onConfirm: async () => {
      // Upload + gộp "Hồ Sơ Đề Nghị Thanh Toán" mới chọn (nếu có) TRƯỚC — bắt buộc >=1 tệp mới cho gửi
      // (mirror đúng luật server ở submitPaymentRequest(), lib/recordActions.js).
      let requestFiles;
      try {
        requestFiles = await collectAndUploadPaymentManageRequestFiles(id);
      } catch (err) { return alert(`⛔ Tải tệp lên thất bại: ${err.message}`); }
      // Đang sửa dở -> LUÔN lưu lại đúng nội dung mới nhất (installments + requestFiles) TRƯỚC, kể cả
      // khi sắp bị chặn ở bước kiểm tra requestFiles ngay bên dưới — nếu không, người dùng gõ đủ số tiền
      // xong bấm gửi mà quên đính kèm tệp sẽ bị MẤT TRẮNG các đợt vừa sửa (chỉ hiện lỗi, không lưu gì).
      let afterEdit;
      try {
        const editResult = await callRecordAction('paymentRequests', id, 'edit', { installments, requestFiles });
        afterEdit = editResult.item;
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const editIdx = DB.paymentRequests.findIndex(x => x.id === id);
      if (editIdx !== -1) DB.paymentRequests[editIdx] = afterEdit;
      if (!requestFiles.length) {
        renderPaymentManageTab();
        return alert('⛔ Vui lòng đính kèm ít nhất 1 tệp "Hồ Sơ Đề Nghị Thanh Toán" trước khi chuyển xác nhận thanh toán!');
      }
      let updated;
      try {
        const result = await callRecordAction('paymentRequests', id, 'submit', {});
        updated = result.item;
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.paymentRequests.findIndex(x => x.id === id);
      if (idx !== -1) DB.paymentRequests[idx] = updated;
      logSystemAction('OFFICE', 'SUBMIT_PAYMENT_REQUEST', `Chuyển xác nhận thanh toán đề nghị [${updated.title}]`, 'SUCCESS', String(updated.id));
      alert('✅ Đã gửi đề nghị thanh toán đi duyệt theo phòng ban!');
      managePaymentExpandedId = null;
      renderPaymentManageTab();
      refreshApprovalSurfaces();
    }
  });
}

function renderPaymentManageTab() {
  const container = document.getElementById('paymentManageList');
  if (!container) return;
  const canManage = canManagePaymentRequestsClient(currentUser);
  // Vừa điều hướng từ "🧾 Lập Thanh Toán" (module Hợp Đồng) -> tự mở sẵn đúng đề nghị vừa tạo, dùng 1
  // lần rồi xoá ngay (xem chú thích pendingManagePaymentFocusId ở core.js).
  if (pendingManagePaymentFocusId != null) {
    managePaymentExpandedId = pendingManagePaymentFocusId;
    pendingManagePaymentFocusId = null;
  }
  // TRƯỚC ĐÂY lọc bỏ hẳn PAID ở đây -> đề nghị "biến mất" khỏi "Quản Lý Thanh Toán" ngay sau khi xác nhận
  // hoàn tất thanh toán (bug nghiệp vụ #1: "mà không bị biến mất như bây giờ sau khi xác nhận hoàn thành
  // thanh toán") — giờ giữ lại PAID để người tạo vẫn theo dõi được trạng thái/lịch sử tại đây, không chỉ
  // ở sub-tab "✅ Xác Nhận Đề Nghị Thanh Toán".
  const all = (DB.paymentRequests || []).filter(pr => ['DRAFT', 'PENDING', 'APPROVED', 'PAID'].includes(pr.status));
  populatePaymentManageFilterOptions(all);
  const list = all.filter(pr => !managePaymentFilterSource || pr.sourceCode === managePaymentFilterSource);
  if (!list.length) {
    container.innerHTML = '<p class="text-center p-6 text-gray-500 italic bg-white rounded border">Chưa có đề nghị thanh toán nào đang lập/chờ xử lý.</p>';
    return;
  }
  container.innerHTML = list.map(pr => {
    const canEditThis = canManage || pr.createdBy === currentUser.username;
    const isExpanded = managePaymentExpandedId === pr.id;
    const totalAmount = (pr.installments || []).reduce((s, it) => s + (it.amount || 0), 0);
    const readOnlyRows = (pr.installments || []).map((it, idx) => `
      <div class="flex items-center justify-between gap-2 text-[11px] text-gray-700 border-b py-1">
        <span>${escapeHtml(it.description || '')} — ${it.amount != null ? it.amount.toLocaleString('vi-VN') + ' VNĐ' : '<span class="italic text-gray-400">(chưa nhập số tiền)</span>'}${it.dueDate ? ` — hạn ${escapeHtml(it.dueDate)}` : ''}
          ${it.confirmFileUrl ? `<button type="button" data-op="viewPaymentConfirmFile" data-arg0="${pr.id}" data-arg1="${idx}" class="text-cyan-600 hover:underline ml-1">📎 Xem tệp</button>` : ''}
        </span>
        ${paymentInstallmentDeadlineBadge(it)}
      </div>
    `).join('') || '<p class="text-gray-400 italic text-[11px]">Chưa có đợt thanh toán nào.</p>';
    const lumpFileRow = pr.lumpConfirmFileUrl ? `
      <div class="text-[11px] text-gray-700 border-b py-1">
        📎 Tệp đề nghị thanh toán đã phê duyệt (toàn bộ):
        <button type="button" data-op="viewPaymentConfirmFile" data-arg0="${pr.id}" class="text-cyan-600 hover:underline">${escapeHtml(pr.lumpConfirmFileName || 'Xem tệp')}</button>
      </div>` : '';
    // "Hồ Sơ Đề Nghị Thanh Toán" (multi-file) đã đính kèm — hiện cả 2 chế độ (đang sửa NHÁP lẫn chỉ xem),
    // luôn liệt kê để người tạo/kế toán thấy đã có gì trước khi "Chuyển Xác Nhận Thanh Toán".
    const requestFilesListHTML = (pr.requestFiles || []).length
      ? `<div class="flex flex-wrap gap-1 mt-1">${pr.requestFiles.map(f => `<span class="inline-flex items-center gap-1 bg-gray-100 border rounded px-2 py-0.5 text-[11px]"><button type="button" data-op="viewPaymentRequestFile" data-arg0="${pr.id}" data-arg1="${escapeHtml(f.fileUrl)}" data-arg2="${escapeHtml(f.fileName)}" data-arg3="${escapeHtml(f.fileType || '')}" class="text-cyan-700 hover:underline">📎 ${escapeHtml(f.fileName)}</button></span>`).join('')}</div>`
      : '<p class="text-gray-400 italic text-[11px] mt-1">Chưa đính kèm tệp nào.</p>';
    return `
      <div class="bg-white p-3 rounded border space-y-2">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="font-bold text-gray-800">${PAYMENT_SOURCE_LABELS[pr.sourceModule] || pr.sourceModule}${pr.sourceCode ? ` — <span class="font-mono text-xs">${escapeHtml(pr.sourceCode)}</span>` : ''}</div>
            <div class="text-sm text-gray-700">${escapeHtml(pr.title)}</div>
            <div class="text-xs text-gray-500">Phòng ban: ${escapeHtml(pr.dept)} | Tổng hiện tại: ${totalAmount.toLocaleString('vi-VN')} VNĐ</div>
            ${paymentWarningCountsHTML(pr)}
          </div>
          <div class="text-right space-y-1 whitespace-nowrap">
            <div><span class="px-2 py-0.5 rounded font-bold text-xs ${PAYMENT_STATUS_BADGE_CLS[pr.status] || ''}">${PAYMENT_STATUS_LABELS[pr.status] || pr.status}</span></div>
            <div>${paymentOverallStatusBadge(pr)}</div>
          </div>
        </div>
        ${pr.status === 'DRAFT' && canEditThis ? (isExpanded ? `
          <div class="border-t pt-2 space-y-2">
            <div class="flex justify-between items-center">
              <label class="font-semibold text-gray-600 text-xs">Các Đợt Thanh Toán (số tiền có thể để trống — chỉ bắt buộc khi Chuyển Xác Nhận Thanh Toán)</label>
              <button type="button" data-op="addPaymentManageInstallmentRow" data-arg0="${pr.id}" class="text-amber-600 font-bold hover:underline text-xs">+ Thêm Đợt</button>
            </div>
            <div id="paymentManageInstallmentsList_${pr.id}" class="space-y-2"></div>
            <div class="border-t pt-2">
              <label class="font-semibold text-gray-600 text-xs">📎 Hồ Sơ Đề Nghị Thanh Toán (có thể chọn nhiều tệp — bắt buộc ít nhất 1 tệp trước khi Chuyển Xác Nhận Thanh Toán)</label>
              ${requestFilesListHTML}
              <input id="paymentManageRequestFilesInput_${pr.id}" type="file" multiple data-op-change="onMultiFileChosen" data-arg-el="0" data-arg1="paymentManageRequestFilesChips_${pr.id}" class="w-full border p-1.5 rounded bg-white mt-1 text-xs">
              <div id="paymentManageRequestFilesChips_${pr.id}" class="flex flex-wrap gap-1 mt-1"></div>
            </div>
            <div class="flex justify-end gap-2 pt-1">
              <button type="button" data-op="closePaymentManageEdit" class="bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-300">Đóng</button>
              <button type="button" data-op="savePaymentManageDraft" data-arg0="${pr.id}" class="bg-gray-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-700">💾 Lưu</button>
              <button type="button" data-op="submitPaymentRequestAction" data-arg0="${pr.id}" class="bg-amber-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-amber-700">📨 Chuyển Xác Nhận Thanh Toán</button>
            </div>
          </div>
        ` : `
          <div class="border-t pt-2">${readOnlyRows}${lumpFileRow}<div class="mt-1"><span class="text-[11px] font-semibold text-gray-600">📎 Hồ Sơ Đề Nghị Thanh Toán:</span>${requestFilesListHTML}</div></div>
          <div class="flex justify-end gap-2 pt-1">
            <button type="button" data-op="openPaymentManageEdit" data-arg0="${pr.id}" class="bg-amber-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-amber-700">✏️ Lập / Sửa Đợt Thanh Toán</button>
          </div>
        `) : `<div class="border-t pt-2">${readOnlyRows}${lumpFileRow}<div class="mt-1"><span class="text-[11px] font-semibold text-gray-600">📎 Hồ Sơ Đề Nghị Thanh Toán:</span>${requestFilesListHTML}</div></div>`}
      </div>
    `;
  }).join('');
  // renderPaymentManageInstallmentsList() PHẢI chạy SAU khi innerHTML ở trên đã tạo xong container đích
  // (#paymentManageInstallmentsList_<id>) — mảng installments hiện tại của đề nghị đang mở, nếu có.
  if (managePaymentExpandedId != null) {
    const openPr = list.find(pr => pr.id === managePaymentExpandedId && pr.status === 'DRAFT');
    if (openPr) renderPaymentManageInstallmentsList(openPr.id, openPr.installments || []);
  }
}

// "✅ Xác Nhận Đề Nghị Thanh Toán" — sub-tab này giờ CHỈ còn là hàng chờ duyệt theo bước/phòng ban + xác
// nhận PAID từng đợt (đúng tinh thần "purely the dept-approval-progression + PAID-confirmation queue"),
// KHÔNG còn hiện đề nghị DRAFT nữa (lập/sửa đợt NHÁP giờ ở hẳn sub-tab "🗂️ Quản Lý Thanh Toán") — cả 2
// sub-tab đọc CHUNG DB.paymentRequests nên mọi thay đổi trạng thái ở đây tự động phản ánh sang tab kia
// (và ngược lại), không cần cơ chế đồng bộ riêng.
function renderPaymentRequests() {
  const tbody = document.getElementById('paymentTableBody');
  if (!tbody) return;
  const allRequests = (DB.paymentRequests || []).filter(pr => pr.status !== 'DRAFT');
  const statusFilter = document.getElementById('filterStatusPayment')?.value || '';

  const paymentDashCards = [
    { key: '', label: 'Tổng Đề Nghị', count: allRequests.length, colorClass: 'border-l-blue-500' },
    { key: 'PENDING', label: 'Chờ Duyệt', count: allRequests.filter(pr => pr.status === 'PENDING').length, colorClass: 'border-l-yellow-500' },
    { key: 'NEED_INFO', label: 'Cần Bổ Sung', count: allRequests.filter(pr => pr.status === 'NEED_INFO').length, colorClass: 'border-l-orange-500' },
    { key: 'APPROVED', label: 'Đã Duyệt (Chờ Xác Nhận)', count: allRequests.filter(pr => pr.status === 'APPROVED').length, colorClass: 'border-l-sky-500' },
    { key: 'PAID', label: 'Đã Thanh Toán', count: allRequests.filter(pr => pr.status === 'PAID').length, colorClass: 'border-l-green-500' }
  ];
  const dashEl = document.getElementById('paymentDashboardCards');
  if (dashEl) dashEl.innerHTML = buildDashboardCardsHTML(paymentDashCards, statusFilter, 'filterPaymentByCard');

  const list = allRequests.filter(pr => !statusFilter || pr.status === statusFilter);
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center p-6 text-gray-500 italic">Chưa có đề nghị thanh toán nào.</td></tr>`;
    return;
  }
  const canManage = canManagePaymentRequestsClient(currentUser);
  tbody.innerHTML = list.map(pr => {
    // ONE_TIME (Thanh toán 1 lần) — badge từng đợt CHỈ để theo dõi/hiển thị (yêu cầu nghiệp vụ #3), KHÔNG
    // có nút "Xác nhận" riêng cho từng đợt (xác nhận TOÀN BỘ 1 lần, xem nút "💰 Xác Nhận Toàn Bộ" bên dưới
    // — confirmPaymentInstallment() ở server CŨNG tự chặn 409 nếu cố gọi thẳng route, đây không phải lớp
    // gác duy nhất). PERIODIC/thủ công/nguồn không có paymentType (sourcePaymentType !== 'ONE_TIME') vẫn
    // xác nhận TỪNG ĐỢT như cũ — không còn bắt buộc upload tệp ở đây nữa (xem chú thích đầu khối
    // "✅ Xác Nhận Thanh Toán" — "Hồ Sơ Đề Nghị Thanh Toán" đã bắt buộc đính kèm từ lúc gửi).
    const isOneTime = pr.sourcePaymentType === 'ONE_TIME';
    const requestFilesHTMLApprove = (pr.requestFiles || []).length
      ? `<div class="flex flex-wrap gap-1 mt-1">${pr.requestFiles.map(f => `<span class="inline-flex items-center gap-1 bg-gray-100 border rounded px-1.5 py-0.5 text-[10px]"><button type="button" data-op="viewPaymentRequestFile" data-arg0="${pr.id}" data-arg1="${escapeHtml(f.fileUrl)}" data-arg2="${escapeHtml(f.fileName)}" data-arg3="${escapeHtml(f.fileType || '')}" class="text-cyan-700 hover:underline">📎 ${escapeHtml(f.fileName)}</button></span>`).join('')}</div>`
      : '';
    const installmentsHTML = (pr.installments || []).map((it, idx) => `
      <div class="flex items-center justify-between gap-2 text-[11px] ${it.confirmed ? 'text-green-700' : 'text-gray-600'}">
        <span>${it.confirmed ? '✅' : '⬜'} ${escapeHtml(it.description || '')} — ${(it.amount || 0).toLocaleString('vi-VN')} VNĐ
          ${it.confirmFileUrl ? `<button type="button" data-op="viewPaymentConfirmFile" data-arg0="${pr.id}" data-arg1="${idx}" class="text-cyan-600 hover:underline ml-1">📎</button>` : ''}
        </span>
        ${(!it.confirmed && pr.status === 'APPROVED' && canManage && !isOneTime) ? `<button data-op="confirmPaymentInstallmentAction" data-arg0="${pr.id}" data-arg1="${idx}" class="text-cyan-600 font-bold hover:underline">Xác nhận</button>` : ''}
      </div>
    `).join('');
    return `
      <tr class="hover:bg-gray-50 border-b align-top">
        <td class="border p-2 font-bold">${PAYMENT_SOURCE_LABELS[pr.sourceModule] || pr.sourceModule}${pr.sourceCode ? `<div class="text-[10px] text-gray-500 font-normal font-mono">${escapeHtml(pr.sourceCode)}</div>` : ''}</td>
        <td class="border p-2">${escapeHtml(pr.dept)}<br><span class="text-xs text-gray-500">${escapeHtml(pr.title)}</span></td>
        <td class="border p-2">
          <div class="font-bold text-purple-700">${(pr.amount || 0).toLocaleString('vi-VN')} VNĐ</div>
          ${pr.amountMismatchesSource ? `<div class="mt-0.5 text-[11px] font-bold text-red-600">⚠️ Lệch giá trị nguồn (${(pr.referenceAmount || 0).toLocaleString('vi-VN')} VNĐ)</div>` : ''}
          <div class="mt-1 space-y-0.5">${installmentsHTML}</div>
          ${pr.lumpConfirmFileUrl ? `<div class="text-[11px] mt-1">📎 <button type="button" data-op="viewPaymentConfirmFile" data-arg0="${pr.id}" class="text-cyan-600 hover:underline">${escapeHtml(pr.lumpConfirmFileName || 'Tệp đề nghị thanh toán đã phê duyệt')}</button></div>` : ''}
          ${requestFilesHTMLApprove}
          ${paymentWarningCountsHTML(pr)}
        </td>
        <td class="border p-2">
          <div><span class="px-2 py-0.5 rounded font-bold text-xs ${PAYMENT_STATUS_BADGE_CLS[pr.status] || ''}">${PAYMENT_STATUS_LABELS[pr.status] || pr.status}</span></div>
          <div class="mt-1">${paymentOverallStatusBadge(pr)}</div>
        </td>
        <td class="border p-2 text-center space-y-1">
          ${canManage && (pr.status === 'PENDING' || pr.status === 'NEED_INFO') ? `<button data-op="openEditPaymentRequest" data-arg0="${pr.id}" class="block w-full bg-gray-500 text-white px-2 py-1 rounded text-xs font-bold hover:bg-gray-600">✏️ Sửa</button>` : ''}
          ${canApprovePaymentRequestStepClient(currentUser, pr) ? `<button data-op="approvePaymentRequestAction" data-arg0="${pr.id}" class="block w-full bg-emerald-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-emerald-700">✅ Xác nhận</button>` : ''}
          ${canManage && pr.status === 'PENDING' ? `<button data-op="requestPaymentInfoAction" data-arg0="${pr.id}" class="block w-full bg-orange-500 text-white px-2 py-1 rounded text-xs font-bold hover:bg-orange-600">📝 Yêu Cầu Bổ Sung</button>` : ''}
          ${canManage && pr.status === 'APPROVED' && isOneTime ? `<button data-op="confirmPaymentRequestLumpSumAction" data-arg0="${pr.id}" class="block w-full bg-cyan-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-cyan-700">💰 Xác Nhận Toàn Bộ</button>` : ''}
          ${currentUser.perms?.admin && pr.status !== 'PAID' ? `<button data-op="deletePaymentRequestAction" data-arg0="${pr.id}" class="block w-full bg-red-500 text-white px-2 py-1 rounded text-xs font-bold hover:bg-red-600">🗑️ Xoá</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');
}

// Xác nhận ý định TRƯỚC (showConfirmModal), rồi mới tới withApprovalAuth() (xác thực lại mật khẩu/OTP/
// PIN/vân tay nếu tài khoản có cấu hình approverAuthLevel) — đúng thứ tự đã dùng ở 9 module duyệt còn
// lại. Trước đây riêng Duyệt đề nghị thanh toán không gọi withApprovalAuth() nên không hề xin phiếu xác
// thực, trong khi server (routes/records.js) nay bắt buộc phải có -> phải thêm ở đây thì luồng mới chạy
// thông, không phải chỉ chặn lại bằng thông báo lỗi khó hiểu.
// "Xác nhận đề nghị thanh toán" — GIỜ đi qua quy trình duyệt THEO BƯỚC/PHÒNG BAN (paymentDeptWorkflows,
// POST /api/workflow/paymentRequests/:id/approve, xem lib/workflowEngine.js MODULE_CONFIGS.paymentRequests)
// thay cho quyền phẳng canManagePaymentRequests() cũ — cùng khuôn approveContractSignedFileAction() ở
// module-hopdong.js (callWorkflowAction + đọc transition để báo đúng "đã xong hẳn"/"chuyển bước tiếp
// theo"/"đang chờ đồng duyệt còn lại"). CHỈ có Duyệt — module này KHÔNG wire Từ Chối qua engine (xem
// lib/workflowEngine.js MODULE_CONFIGS.paymentRequests disallowReject, quyết định đã chốt với người dùng).
function approvePaymentRequestAction(id) {
  const pr = DB.paymentRequests.find(x => x.id === id);
  if (!pr) return;
  showConfirmModal({
    title: 'Xác nhận đề nghị thanh toán',
    bodyHTML: `Xác nhận đề nghị thanh toán "<b>${escapeHtml(pr.title)}</b>"?`,
    confirmLabel: 'Xác Nhận',
    onConfirm: () => withApprovalAuth(async () => {
      let result;
      try {
        result = await callWorkflowAction('paymentRequests', id, 'approve', {});
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const updated = result.item;
      const transition = result.transition;
      const idx = DB.paymentRequests.findIndex(x => x.id === id);
      if (idx !== -1) DB.paymentRequests[idx] = updated;
      logSystemAction('OFFICE', 'APPROVE_PAYMENT_REQUEST', `Xác nhận đề nghị thanh toán [${updated.title}]`, 'SUCCESS', String(updated.id));
      let msg = '✅ Đã ghi nhận phê duyệt của bạn!';
      if (transition.type === 'COMPLETED') msg = '✅ Xác nhận đề nghị thanh toán thành công — có thể xác nhận thanh toán từng đợt!';
      else if (transition.type === 'ADVANCED') msg = getStepAdvanceMessage(transition.stepApprovers);
      else if (transition.type === 'PARTIAL_APPROVE') msg = '✅ Đã ghi nhận phê duyệt của bạn — đang chờ các đồng phê duyệt còn lại ở bước này.';
      alert(msg);
      renderPaymentRequests();
      refreshApprovalSurfaces();
    })
  });
}

function requestPaymentInfoAction(id) {
  const pr = DB.paymentRequests.find(x => x.id === id);
  if (!pr) return;
  const comment = prompt('Nhập nội dung cần bổ sung:');
  if (comment === null) return;
  if (!comment.trim()) return alert('⛔ Vui lòng nhập nội dung cần bổ sung!');
  showConfirmModal({
    title: 'Yêu cầu bổ sung',
    bodyHTML: `Yêu cầu bổ sung cho đề nghị "<b>${escapeHtml(pr.title)}</b>"?<br><span class="text-xs text-gray-500">${escapeHtml(comment.trim())}</span>`,
    confirmLabel: 'Gửi Yêu Cầu',
    onConfirm: async () => {
      let updated;
      try {
        const result = await callRecordAction('paymentRequests', id, 'request-info', { comment: comment.trim() });
        updated = result.item;
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.paymentRequests.findIndex(x => x.id === id);
      if (idx !== -1) DB.paymentRequests[idx] = updated;
      logSystemAction('OFFICE', 'REQUEST_PAYMENT_INFO', `Yêu cầu bổ sung đề nghị thanh toán [${updated.title}]: ${comment.trim()}`, 'SUCCESS', String(updated.id));
      renderPaymentRequests();
    }
  });
}

function deletePaymentRequestAction(id) {
  const pr = DB.paymentRequests.find(x => x.id === id);
  if (!pr) return;
  showConfirmModal({
    title: 'Xoá đề nghị thanh toán',
    bodyHTML: `Bạn có chắc chắn muốn xoá đề nghị "<b>${escapeHtml(pr.title)}</b>"?`,
    confirmLabel: 'Xoá',
    onConfirm: async () => {
      try {
        await callRecordAction('paymentRequests', id, 'delete', {});
      } catch (err) { return alert(`⛔ ${err.message}`); }
      DB.paymentRequests = DB.paymentRequests.filter(x => x.id !== id);
      logSystemAction('OFFICE', 'DELETE_PAYMENT_REQUEST', `Xoá đề nghị thanh toán [${pr.title}]`, 'SUCCESS', String(id));
      renderPaymentRequests();
    }
  });
}

// ========== "✅ Xác Nhận Thanh Toán" — KHÔNG còn bắt buộc upload tệp ở bước này nữa (ĐẢO NGƯỢC lại thiết
// kế cũ): "Hồ Sơ Đề Nghị Thanh Toán" giờ đã bắt buộc đính kèm NGAY LÚC TẠO/GỬI (xem "🗂️ Quản Lý Thanh
// Toán"/submitPaymentRequestAction()), nên bước xác nhận này chỉ còn là 1 xác nhận đơn thuần qua
// showConfirmModal() — dùng CHUNG applyPaymentConfirmResult() cho cả xác nhận TỪNG ĐỢT
// (confirmPaymentInstallmentAction()) và TOÀN BỘ 1 LẦN (confirmPaymentRequestLumpSumAction(), CHỈ nguồn
// Hợp đồng "Thanh toán 1 lần", ONE_TIME). ==========
function confirmPaymentInstallmentAction(id, index) {
  const pr = DB.paymentRequests.find(x => x.id === id);
  if (!pr) return;
  const it = pr.installments[index];
  if (!it) return;
  showConfirmModal({
    title: 'Xác nhận thanh toán đợt',
    bodyHTML: `Xác nhận đã thanh toán đợt "<b>${escapeHtml(it.description || '')}</b>" (${(it.amount || 0).toLocaleString('vi-VN')} VNĐ)?`,
    confirmLabel: 'Xác Nhận',
    onConfirm: async () => {
      let updated, justCompleted;
      try {
        const result = await callRecordAction('paymentRequests', id, 'confirm-installment', { index });
        updated = result.item; justCompleted = result.justCompleted;
      } catch (err) { return alert(`⛔ ${err.message}`); }
      applyPaymentConfirmResult(updated, justCompleted, `Xác nhận thanh toán đợt [${it.description || ''}] cho [${updated.title}]`);
    }
  });
}
// "💰 Xác Nhận Toàn Bộ" — CHỈ hiện/gọi được cho đề nghị sourcePaymentType === 'ONE_TIME' (xem gate ở
// renderPaymentRequests()) — server (confirmPaymentRequestLumpSum(), lib/recordActions.js) TỰ chặn 409
// nếu cố gọi trên đề nghị khác loại, đây không phải lớp gác duy nhất.
function confirmPaymentRequestLumpSumAction(id) {
  const pr = DB.paymentRequests.find(x => x.id === id);
  if (!pr) return;
  showConfirmModal({
    title: 'Xác nhận thanh toán (toàn bộ)',
    bodyHTML: `Xác nhận TOÀN BỘ đề nghị "<b>${escapeHtml(pr.title)}</b>" (${(pr.amount || 0).toLocaleString('vi-VN')} VNĐ) đã thanh toán — áp dụng cho tất cả các đợt?`,
    confirmLabel: 'Xác Nhận',
    onConfirm: async () => {
      let updated, justCompleted;
      try {
        const result = await callRecordAction('paymentRequests', id, 'confirm-lump-sum', {});
        updated = result.item; justCompleted = result.justCompleted;
      } catch (err) { return alert(`⛔ ${err.message}`); }
      applyPaymentConfirmResult(updated, justCompleted, `Xác nhận thanh toán TOÀN BỘ [${updated.title}]`);
    }
  });
}
// Đủ hết các đợt (hoặc xác nhận lump-sum) thì server tự chuyển PAID (justCompleted=true) và đã ghi ngược
// paymentStatus vào bản ghi nguồn; client chỉ cần đồng bộ lại cục bộ để UI cập nhật ngay, không cần tải
// lại trang. Dùng chung cho cả 2 đường xác nhận (từng đợt/toàn bộ) ở trên.
function applyPaymentConfirmResult(updated, justCompleted, logDetail) {
  const idx = DB.paymentRequests.findIndex(x => x.id === updated.id);
  if (idx !== -1) DB.paymentRequests[idx] = updated;
  logSystemAction('OFFICE', 'CONFIRM_PAYMENT_INSTALLMENT', logDetail, 'SUCCESS', String(updated.id));
  if (justCompleted) {
    if (updated.sourceModule === 'CONTRACT') {
      const c = DB.contracts.find(x => x.id === updated.sourceId);
      // Khớp ĐÚNG logic ghi ngược ở routes/records.js: hợp đồng "Thanh toán định kỳ" (PERIODIC) trả
      // về CHUA_THANH_TOAN (mở lại chu kỳ mới) thay vì DA_THANH_TOAN (khoá cứng) như "Thanh toán 1
      // lần" — trước đây (chưa có paymentType) luôn cứng DA_THANH_TOAN, giờ phải tính theo ĐÚNG loại
      // hợp đồng để đồng bộ cục bộ khớp với server, không cần tải lại trang mới thấy đúng.
      if (c) c.paymentStatus = c.paymentType === 'PERIODIC' ? 'CHUA_THANH_TOAN' : 'DA_THANH_TOAN';
    } else if (updated.sourceId != null) {
      const o = DB.officeReqs.find(x => x.id === updated.sourceId);
      if (o) o.paymentStatus = 'DA_THANH_TOAN';
    }
    alert('✅ Thanh toán thành công! Đề nghị đã hoàn tất tất cả các đợt.');
  }
  renderPaymentRequests();
  renderPaymentManageTab();
  if (activeContractSubTab) renderContracts();
  if (activeOfficeSubTab && activeOfficeSubTab !== 'PAYMENT') renderOfficeReqs();
}

// Xem tệp "đề nghị thanh toán đã phê duyệt" đính kèm lúc xác nhận CŨ (dữ liệu lịch sử trước bản vá này —
// bước xác nhận không còn bắt buộc/tạo tệp mới nữa, xem applyPaymentConfirmResult() ở trên) — GIỮ LẠI để
// vẫn xem được tệp cũ trên các đề nghị đã PAID trước đây. index=null (hoặc bỏ trống, đúng khuôn data-arg0
// duy nhất không kèm data-arg1) nghĩa là tệp lump-sum (toàn bộ đề nghị), index là số nghĩa là tệp của
// ĐÚNG đợt đó.
function viewPaymentConfirmFile(prId, index) {
  const pr = DB.paymentRequests.find(x => x.id === prId);
  if (!pr) return;
  let fileUrl, fileType, fileName, title;
  if (index == null || index === undefined) {
    fileUrl = pr.lumpConfirmFileUrl; fileType = pr.lumpConfirmFileType; fileName = pr.lumpConfirmFileName;
    title = `📎 Tệp Đề Nghị Thanh Toán Đã Phê Duyệt (Toàn Bộ) — ${pr.title}`;
  } else {
    const it = pr.installments?.[index];
    fileUrl = it?.confirmFileUrl; fileType = it?.confirmFileType; fileName = it?.confirmFileName;
    title = `📎 Tệp Đề Nghị Thanh Toán Đã Phê Duyệt — ${it?.description || ''} (${pr.title})`;
  }
  if (!fileUrl) return;
  openFileProtectedView({ title, sub: `Phòng ban: ${pr.dept}`, fileSrc: fileUrl, fileType, fileName });
}

// Xem 1 tệp trong "Hồ Sơ Đề Nghị Thanh Toán" (multi-file, đính kèm NGAY LÚC TẠO/GỬI — xem
// normalizePaymentRequestFiles() ở lib/recordActions.js) — nhận thẳng fileUrl/fileName/fileType qua
// data-arg (không tra lại theo index như viewPaymentConfirmFile() vì đây là mảng phẳng không đợt).
function viewPaymentRequestFile(prId, fileUrl, fileName, fileType) {
  const pr = DB.paymentRequests.find(x => x.id === prId);
  if (!pr || !fileUrl) return;
  openFileProtectedView({ title: `📎 Hồ Sơ Đề Nghị Thanh Toán — ${escapeHtml(fileName || '')} (${escapeHtml(pr.title)})`, sub: `Phòng ban: ${pr.dept}`, fileSrc: fileUrl, fileType, fileName });
}

// Xem đầy đủ TOÀN BỘ thông tin đã nhập của hồ sơ hợp đồng (khác với viewContract() ở dưới, vốn chỉ
// hiển thị FILE đính kèm) — các trường như giá trị, ngày hiệu lực/hết hạn, nội dung tóm tắt trước
// đây không có chỗ nào xem đầy đủ ngoài bảng danh sách rút gọn.
function viewContractDetails(contractId) {
  const c = DB.contracts.find(x => x.id === contractId);
  if (!c) return;

  const now = new Date();
  const endD = new Date(c.endDate);
  const diffDays = Math.ceil((endD - now) / (1000 * 60 * 60 * 24));
  let warningBadge = '';
  if (diffDays < 0) {
    warningBadge = `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold">⚠️ Đã hết hạn (${Math.abs(diffDays)} ngày)</span>`;
  } else if (diffDays <= 30) {
    warningBadge = `<span class="px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded font-bold">⏰ Sắp hết hạn (Còn ${diffDays} ngày)</span>`;
  } else {
    warningBadge = `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-semibold">✅ Còn hiệu lực</span>`;
  }

  document.getElementById('viewModalTitle').innerText = `🔍 Chi Tiết Hợp Đồng: ${c.title} (${c.code})`;
  document.getElementById('viewModalSub').innerText = `Phòng ban: ${c.dept} | Đối tác: ${c.partner} | Loại: ${c.type}`;
  document.getElementById('viewModalFooterInfo').innerText = `Người tạo: ${c.creator}${c.lastEditedBy ? ` | Sửa lần cuối bởi: ${c.lastEditedBy} lúc ${c.lastEditedAt}` : ''}`;

  document.getElementById('viewModalContent').innerHTML = `
    <div class="w-full bg-white p-6 rounded shadow border overflow-y-auto text-sm">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div><b>Mã Hợp Đồng / Giấy Phép:</b> ${escapeHtml(c.code)}</div>
        <div><b>Loại Pháp Lý:</b> ${escapeHtml(c.type)}</div>
        <div><b>Phòng Ban Quản Lý:</b> ${escapeHtml(c.dept)}</div>
        ${c.custodianDept && c.custodianDept !== c.dept ? `<div><b>Đơn Vị Tiếp Nhận Theo Dõi &amp; Thanh Toán:</b> <span class="px-2 py-0.5 bg-cyan-100 text-cyan-800 rounded font-semibold">${escapeHtml(c.custodianDept)}</span></div>` : ''}
        <div><b>Đối Tác / Bên Ký Kết:</b> ${escapeHtml(c.partner)}</div>
        <div class="md:col-span-2"><b>Tên Hợp Đồng / Giấy Phép:</b> ${escapeHtml(c.title)}</div>
        <div><b>Giá Trị Hợp Đồng:</b> ${(c.amount || 0).toLocaleString('vi-VN')} VNĐ</div>
        <div><b>Trạng Thái:</b> ${warningBadge}</div>
        <div><b>Ngày Hiệu Lực:</b> ${escapeHtml(c.startDate)}</div>
        <div><b>Ngày Hết Hạn:</b> ${escapeHtml(c.endDate)}</div>
        <div><b>Người Tạo:</b> ${escapeHtml(c.creator)}</div>
        <div><b>Ngày Tạo:</b> ${escapeHtml(c.createdAt)}</div>
        ${c.lastEditedBy ? `
          <div><b>Sửa Lần Cuối Bởi:</b> ${escapeHtml(c.lastEditedBy)}</div>
          <div><b>Thời Gian Sửa:</b> ${escapeHtml(c.lastEditedAt || '')}</div>
        ` : ''}
        ${c.fileName ? `<div class="md:col-span-2"><b>Tệp Đính Kèm:</b> ${escapeHtml(c.fileName)}</div>` : ''}
        ${c.isAddendum ? `<div class="md:col-span-2"><b>Phụ lục của hợp đồng:</b> ${escapeHtml((DB.contracts.find(r => r.id === c.rootContractId) || {}).code || '')}</div>` : ''}
        <div><b>Trạng Thái Duyệt:</b> ${c.approvalStatus === 'PENDING' ? '⏳ Chờ duyệt' : c.approvalStatus === 'REJECTED' ? `❌ Bị từ chối${c.rejectReason ? ` (${escapeHtml(c.rejectReason)})` : ''}` : '✅ Đã duyệt'}</div>
        <div><b>Loại Thanh Toán:</b> ${c.paymentType === 'PERIODIC' ? '🔁 Thanh toán định kỳ' : 'Thanh toán 1 lần'}</div>
        <div><b>Thanh Toán:</b> ${CONTRACT_PAYMENT_LABELS[c.paymentStatus] || '-'}${c.signedFileUrl ? ' (đã có tài liệu ký)' : ''}</div>
      </div>
      ${(c.paymentInstallments || []).length ? `
        <div class="border-t mt-4 pt-3">
          <b>Các Đợt Thanh Toán:</b>
          <ul class="list-disc pl-5 mt-1 text-gray-800">
            ${c.paymentInstallments.map(it => `<li>${escapeHtml(it.description || '')} — ${(it.amount || 0).toLocaleString('vi-VN')} VNĐ${it.dueDate ? ` (hạn ${escapeHtml(it.dueDate)})` : ''}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
      <div class="border-t mt-4 pt-3">
        <b>Nội Dung Tóm Tắt & Điều Khoản Chính:</b>
        <div class="bg-gray-50 p-3 rounded border mt-1 text-gray-800">${escapeHtml(c.content || 'Không có mô tả.')}</div>
      </div>
      ${(c.customData && Object.keys(c.customData).length > 0) ? `
        <div class="border-t mt-4 pt-3">
          <b>Trường Bổ Sung (Phê Duyệt):</b>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
            ${Object.keys(c.customData).map(k => `<div><b>${escapeHtml(k)}:</b> ${escapeHtml(String(c.customData[k]))}</div>`).join('')}
          </div>
        </div>
      ` : ''}
      ${(c.signedCustomData && Object.keys(c.signedCustomData).length > 0) ? `
        <div class="border-t mt-4 pt-3">
          <b>Trường Bổ Sung (Quản Lý HĐ & Giấy Phép):</b>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
            ${Object.keys(c.signedCustomData).map(k => `<div><b>${escapeHtml(k)}:</b> ${escapeHtml(String(c.signedCustomData[k]))}</div>`).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
  document.getElementById('viewDocModal').classList.remove('hidden');
}

function viewContract(contractId) {
  const c = DB.contracts.find(x => x.id === contractId);
  if (!c) return;
  const fileSrc = c.fileUrl || c.fileData;

  openFileProtectedView({
    title: `📄 ${c.title} (${c.code})`,
    sub: `Phòng ban: ${c.dept} | Đối tác: ${c.partner} | Loại: ${c.type}`,
    footerInfo: `Trích lược: ${c.content || 'Không có mô tả'}`,
    fileSrc, fileType: c.fileType, fileName: c.fileName,
    noFileFallbackHTML: `
      <div class="w-full h-[60vh] bg-white p-6 rounded shadow border overflow-y-auto relative protected-view-container" data-no-ctxmenu>
        <div data-style="${PROTECTED_VIEW_WATERMARK_STYLE}">${escapeHtml(PROTECTED_VIEW_WATERMARK_COMPANY)}</div>
        <h4 class="font-bold text-lg text-gray-800 border-b pb-2 mb-4">${escapeHtml(c.title)} (${escapeHtml(c.code)})</h4>
        <div class="text-sm text-gray-700 space-y-3">
          <p><b>Đối tác:</b> ${escapeHtml(c.partner)}</p>
          <p><b>Phòng ban:</b> ${escapeHtml(c.dept)}</p>
          <p><b>Nội dung / Điều khoản chính:</b></p>
          <div class="bg-gray-50 p-4 rounded border text-gray-800 italic">
            ${escapeHtml(c.content || 'Không có mô tả chi tiết.')}
          </div>
        </div>
      </div>
    `
  });
}

// Xem "Tài liệu ký" (bản cứng đã ký thật, tải lên qua submitSignedUpload() để mở nút Thanh Toán) — trước
// đây chỉ hiện badge "📎 Đã có tài liệu ký", KHÔNG xem được trong hệ thống. Dùng chung khung
// openFileProtectedView() nên tự động có watermark như mọi tệp đính kèm khác.
function viewContractSignedFile(contractId) {
  const c = DB.contracts.find(x => x.id === contractId);
  if (!c || !c.signedFileUrl) return;
  openFileProtectedView({
    title: `📎 Tài Liệu Ký — ${c.title} (${c.code})`,
    sub: `Phòng ban: ${c.dept} | Đối tác: ${c.partner}`,
    footerInfo: 'Bản đã ký chính thức, dùng để đối chiếu khi thanh toán.',
    fileSrc: c.signedFileUrl, fileType: c.signedFileType, fileName: c.signedFileName
  });
}

