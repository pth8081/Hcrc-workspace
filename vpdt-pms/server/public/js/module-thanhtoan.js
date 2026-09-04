// ==========================================
// MODULE CON "THANH TOÁN" (module "Tổng Hợp") — tổng hợp đề nghị thanh toán tự sinh từ Hợp đồng/Mua
// Bán/Sửa Chữa/Đầu Tư (bấm "Chuyển Sang Thanh Toán") lẫn tạo thủ công. Vòng đời PENDING (sửa được) ->
// [NEED_INFO (sửa được)] -> APPROVED (xác nhận từng đợt) -> PAID (khoá cứng) — xem lib/recordActions.js.
// ==========================================
let editingPaymentRequestId = null;

function canManagePaymentRequestsClient(user) {
  return !!(user?.perms?.admin || user?.perms?.paymentManage);
}

function setPaymentSubTab(subTab) {
  window.scrollTo({ top: 0, behavior: 'auto' }); // Tránh "bay xuống cuối" khi đổi tab con — xem setSystemSubTab().
  activePaymentSubTab = subTab;
  const activeCls = 'px-3 py-1 rounded text-xs font-bold bg-amber-700 text-white';
  const inactiveCls = 'px-3 py-1 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnPaymentSubCreate').className = subTab === 'CREATE' ? activeCls : inactiveCls;
  document.getElementById('btnPaymentSubApprove').className = subTab === 'APPROVE' ? activeCls : inactiveCls;
  document.getElementById('paymentCreateWrap').classList.toggle('hidden', subTab !== 'CREATE');
  if (subTab === 'CREATE' && editingPaymentRequestId === null) cancelEditPaymentRequest();
  renderPaymentRequests();
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

  let newPr;
  let updatedSourceItem = null;
  try {
    if (sourceType === 'MANUAL') {
      const result = await callCreateAction('paymentRequests', { dept, title, installments });
      newPr = result.item;
    } else {
      const result = await callCreatePaymentRequestFromSource({ sourceModule: sourceType, sourceId, title, installments });
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
  logSystemAction('OFFICE', 'CREATE_PAYMENT_REQUEST', `Tạo đề nghị thanh toán ${sourceType === 'MANUAL' ? 'thủ công' : `từ nguồn [${PAYMENT_SOURCE_LABELS[sourceType] || sourceType}]`} [${title}]`, 'SUCCESS', String(newPr.id));
  alert('✅ Đã tạo đề nghị thanh toán!');
  cancelEditPaymentRequest();
  setPaymentSubTab('APPROVE');
}

function cancelEditPaymentRequest() {
  editingPaymentRequestId = null;
  const form = document.getElementById('paymentCreateForm');
  form.reset();
  document.getElementById('paymentSourceTypeWrap').classList.remove('hidden');
  document.getElementById('paymentSourceType').value = 'MANUAL';
  onPaymentSourceTypeChange();
  form.querySelector('button[type="submit"]').innerText = 'Gửi phê duyệt';
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
  document.getElementById('paymentDeptWrap').classList.remove('hidden');
  document.getElementById('paymentDept').value = pr.dept;
  document.getElementById('paymentTitle').value = pr.title;
  renderPaymentCreateInstallmentsList(pr.installments || []);
  document.getElementById('paymentCreateForm').querySelector('button[type="submit"]').innerText = '💾 Cập Nhật Đề Nghị Thanh Toán';
  document.getElementById('paymentCreateForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const PAYMENT_STATUS_LABELS = { PENDING: '⏳ Chờ duyệt', NEED_INFO: '📝 Cần bổ sung', APPROVED: '✅ Đã duyệt (chờ xác nhận)', PAID: '💰 Đã thanh toán' };
const PAYMENT_STATUS_BADGE_CLS = { PENDING: 'bg-amber-100 text-amber-800', NEED_INFO: 'bg-orange-100 text-orange-800', APPROVED: 'bg-blue-100 text-blue-800', PAID: 'bg-green-100 text-green-800' };
const PAYMENT_SOURCE_LABELS = { CONTRACT: '📄 Hợp đồng', MUA_BAN: '🛒 Mua Bán', SUA_CHUA: '🔧 Sửa Chữa', MANUAL: '✍️ Thủ công' };

function onPaymentFilterChange() {
  renderPaymentRequests();
}

function filterPaymentByCard(status) {
  applyDashboardCardFilter({ filterStatusPayment: status }, null, renderPaymentRequests);
}

function renderPaymentRequests() {
  const tbody = document.getElementById('paymentTableBody');
  if (!tbody) return;
  const allRequests = DB.paymentRequests || [];
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
    const installmentsHTML = (pr.installments || []).map((it, idx) => `
      <div class="flex items-center justify-between gap-2 text-[11px] ${it.confirmed ? 'text-green-700' : 'text-gray-600'}">
        <span>${it.confirmed ? '✅' : '⬜'} ${escapeHtml(it.description || '')} — ${(it.amount || 0).toLocaleString('vi-VN')} VNĐ</span>
        ${(!it.confirmed && pr.status === 'APPROVED' && canManage) ? `<button data-op="confirmPaymentInstallmentAction" data-arg0="${pr.id}" data-arg1="${idx}" class="text-cyan-600 font-bold hover:underline">Xác nhận</button>` : ''}
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
        </td>
        <td class="border p-2"><span class="px-2 py-0.5 rounded font-bold text-xs ${PAYMENT_STATUS_BADGE_CLS[pr.status] || ''}">${PAYMENT_STATUS_LABELS[pr.status] || pr.status}</span></td>
        <td class="border p-2 text-center space-y-1">
          ${canManage && (pr.status === 'PENDING' || pr.status === 'NEED_INFO') ? `<button data-op="openEditPaymentRequest" data-arg0="${pr.id}" class="block w-full bg-gray-500 text-white px-2 py-1 rounded text-xs font-bold hover:bg-gray-600">✏️ Sửa</button>` : ''}
          ${canManage && pr.status === 'PENDING' ? `<button data-op="approvePaymentRequestAction" data-arg0="${pr.id}" class="block w-full bg-emerald-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-emerald-700">✅ Xác nhận</button>` : ''}
          ${canManage && pr.status === 'PENDING' ? `<button data-op="requestPaymentInfoAction" data-arg0="${pr.id}" class="block w-full bg-orange-500 text-white px-2 py-1 rounded text-xs font-bold hover:bg-orange-600">📝 Yêu Cầu Bổ Sung</button>` : ''}
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
function approvePaymentRequestAction(id) {
  const pr = DB.paymentRequests.find(x => x.id === id);
  if (!pr) return;
  showConfirmModal({
    title: 'Xác nhận đề nghị thanh toán',
    bodyHTML: `Xác nhận đề nghị thanh toán "<b>${escapeHtml(pr.title)}</b>"?`,
    confirmLabel: 'Xác Nhận',
    onConfirm: () => withApprovalAuth(async () => {
      let updated;
      try {
        const result = await callRecordAction('paymentRequests', id, 'approve', {});
        updated = result.item;
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.paymentRequests.findIndex(x => x.id === id);
      if (idx !== -1) DB.paymentRequests[idx] = updated;
      logSystemAction('OFFICE', 'APPROVE_PAYMENT_REQUEST', `Xác nhận đề nghị thanh toán [${updated.title}]`, 'SUCCESS', String(updated.id));
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

// Xác nhận đã thanh toán 1 đợt — đủ hết các đợt thì server tự chuyển PAID (justCompleted=true) và đã
// ghi ngược paymentStatus vào bản ghi nguồn; client chỉ cần đồng bộ lại cục bộ để UI cập nhật ngay,
// không cần tải lại trang.
function confirmPaymentInstallmentAction(id, index) {
  const pr = DB.paymentRequests.find(x => x.id === id);
  if (!pr) return;
  const it = pr.installments[index];
  showConfirmModal({
    title: 'Xác nhận đã thanh toán',
    bodyHTML: `Xác nhận đã thanh toán đợt "<b>${escapeHtml(it.description || '')}</b>" (${(it.amount || 0).toLocaleString('vi-VN')} VNĐ)?`,
    confirmLabel: 'Xác Nhận',
    onConfirm: async () => {
      let updated, justCompleted;
      try {
        const result = await callRecordAction('paymentRequests', id, 'confirm-installment', { index });
        updated = result.item;
        justCompleted = result.justCompleted;
      } catch (err) { return alert(`⛔ ${err.message}`); }
      const idx = DB.paymentRequests.findIndex(x => x.id === id);
      if (idx !== -1) DB.paymentRequests[idx] = updated;
      logSystemAction('OFFICE', 'CONFIRM_PAYMENT_INSTALLMENT', `Xác nhận thanh toán đợt [${it.description}] cho [${updated.title}]`, 'SUCCESS', String(updated.id));
      if (justCompleted) {
        if (updated.sourceModule === 'CONTRACT') {
          const c = DB.contracts.find(x => x.id === updated.sourceId);
          if (c) c.paymentStatus = 'DA_THANH_TOAN';
        } else if (updated.sourceId != null) {
          const o = DB.officeReqs.find(x => x.id === updated.sourceId);
          if (o) o.paymentStatus = 'DA_THANH_TOAN';
        }
        alert('✅ Thanh toán thành công! Đề nghị đã hoàn tất tất cả các đợt.');
      }
      renderPaymentRequests();
      if (activeContractSubTab) renderContracts();
      if (activeOfficeSubTab && activeOfficeSubTab !== 'PAYMENT') renderOfficeReqs();
    }
  });
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
      <div class="w-full h-[60vh] bg-white p-6 rounded shadow border overflow-y-auto relative protected-view-container" oncontextmenu="return false;">
        <div style="${PROTECTED_VIEW_WATERMARK_STYLE}">${escapeHtml(PROTECTED_VIEW_WATERMARK_COMPANY)}</div>
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

