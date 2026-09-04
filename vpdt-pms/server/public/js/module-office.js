// ==========================================
// 7. MODULE PHÊ DUYỆT VĂN PHÒNG (OFFICE MODULE)
// ==========================================

// --- Bảng nhiều hạng mục cho phiếu Đề Nghị Mua Sắm (Mẫu BM-TS01) ---
function addOfficeItemRow() {
  officeItems.push({ name: '', model: '', unit: '', qty: 0, unitPrice: 0, note: '' });
  renderOfficeItemsTable();
}

function removeOfficeItemRow(idx) {
  officeItems.splice(idx, 1);
  renderOfficeItemsTable();
}

function updateOfficeItemField(idx, field, value) {
  if (!officeItems[idx]) return;
  // unitPrice là ô money-input (đã tự chèn dấu chấm hàng nghìn qua listener "input" chung trên
  // document) — "value" tới đây (bắt trước khi delegate formatter chạy tới document, xem thứ tự
  // bubbling) có thể đã chứa dấu chấm hiển thị từ lần gõ trước, nên PHẢI lọc bỏ ký tự không phải số
  // (Number(...replace(/\D/g,'')...)) thay vì parseFloat() — parseFloat("10.000") sẽ hiểu nhầm dấu
  // chấm là dấu thập phân, cho ra 10 thay vì 10000.
  if (field === 'qty') officeItems[idx][field] = parseFloat(value) || 0;
  else if (field === 'unitPrice') officeItems[idx][field] = Number(String(value || '').replace(/\D/g, '')) || 0;
  else officeItems[idx][field] = value;
  // Chỉ cập nhật ô Thành Tiền của đúng dòng đang sửa + tổng cộng, không render lại toàn bảng để
  // tránh mất focus/con trỏ đang gõ dở ở các dòng khác.
  const amountCell = document.getElementById(`officeItemAmount_${idx}`);
  if (amountCell) amountCell.innerText = ((officeItems[idx].qty || 0) * (officeItems[idx].unitPrice || 0)).toLocaleString('vi-VN');
  recalcOfficeItemsTotal();
}

// Chỉ cộng dồn dòng HỢP LỆ (có Tên tài sản + Số lượng > 0) — khớp đúng điều kiện lọc validItems ở
// submitOfficeReq() (nơi thực sự lưu amount). Trước đây hàm này cộng cả dòng thiếu Tên tài sản, khiến
// "Tổng Dự Toán" hiển thị trên form cao hơn số tiền thực sự được ghi nhận khi gửi.
function recalcOfficeItemsTotal() {
  const total = officeItems.filter(it => (it.name || '').trim() && it.qty > 0).reduce((sum, it) => sum + (it.qty || 0) * (it.unitPrice || 0), 0);
  const el = document.getElementById('officeItemsTotalDisplay');
  if (el) el.innerText = total.toLocaleString('vi-VN');
  return total;
}

function renderOfficeItemsTable() {
  const tbody = document.getElementById('officeItemsTableBody');
  if (!tbody) return;
  tbody.innerHTML = officeItems.map((it, idx) => `
    <tr>
      <td class="border p-1 text-center">${idx + 1}</td>
      <td class="border p-1"><input value="${escapeHtml(it.name)}" data-op-input="updateOfficeItemField" data-arg0="${idx}" data-arg1="name" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Tên tài sản"></td>
      <td class="border p-1"><input value="${escapeHtml(it.model)}" data-op-input="updateOfficeItemField" data-arg0="${idx}" data-arg1="model" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Model"></td>
      <td class="border p-1"><input value="${escapeHtml(it.unit)}" data-op-input="updateOfficeItemField" data-arg0="${idx}" data-arg1="unit" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Cái/Bộ..."></td>
      <td class="border p-1"><input type="number" value="${it.qty || ''}" data-op-input="updateOfficeItemField" data-arg0="${idx}" data-arg1="qty" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none"></td>
      <td class="border p-1"><input type="text" inputmode="numeric" value="${formatMoneyDisplay(it.unitPrice)}" data-op-input="updateOfficeItemField" data-arg0="${idx}" data-arg1="unitPrice" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none money-input"></td>
      <td class="border p-1 text-right font-semibold" id="officeItemAmount_${idx}">${((it.qty || 0) * (it.unitPrice || 0)).toLocaleString('vi-VN')}</td>
      <td class="border p-1"><input value="${escapeHtml(it.note)}" data-op-input="updateOfficeItemField" data-arg0="${idx}" data-arg1="note" data-arg-value="2" class="w-full border-0 p-0.5 text-xs focus:outline-none" placeholder="Ghi chú"></td>
      <td class="border p-1 text-center"><button type="button" data-op="removeOfficeItemRow" data-arg0="${idx}" class="text-red-600 font-bold hover:text-red-800" title="Xoá dòng">✕</button></td>
    </tr>
  `).join('');
  recalcOfficeItemsTotal();
}

async function submitOfficeReq(e) {
  e.preventDefault();
  const code = document.getElementById('offCode').value.trim();
  const dept = document.getElementById('offDept').value;
  const title = document.getElementById('offTitle').value.trim();
  const reason = document.getElementById('offReason').value.trim();
  const isMuaSam = activeOfficeSubTab === 'MUA_BAN';

  if (DB.officeReqs.some(o => o.code === code)) {
    return alert('Mã phiếu đề xuất văn phòng đã tồn tại!');
  }

  let qty = '', amount = 0, supplier = '', usageTime = '', items = null;

  if (isMuaSam) {
    const validItems = officeItems.filter(it => it.name.trim() && it.qty > 0);
    if (validItems.length === 0) {
      return alert('Vui lòng nhập ít nhất 1 hạng mục hợp lệ (có Tên tài sản và Số lượng > 0)!');
    }
    items = validItems.map(it => ({ ...it, amount: it.qty * it.unitPrice }));
    amount = recalcOfficeItemsTotal();
    usageTime = document.getElementById('offUsageTime').value.trim();
  } else {
    qty = document.getElementById('offQty').value.trim();
    amount = getMoneyValue(document.getElementById('offAmount'));
    supplier = document.getElementById('offSupplier').value.trim();
  }

  let customData;
  try {
    customData = await collectDynamicFieldsData(activeOfficeSubTab);
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  const officePayload = {
    code: code,
    subType: activeOfficeSubTab,
    dept: dept,
    title: title,
    qty: qty,
    amount: amount,
    supplier: supplier,
    usageTime: usageTime,
    items: items,
    reason: reason,
    customData: customData,
    createdAt: new Date().toLocaleString('vi-VN'),
    status: 'PENDING',
    currentStep: 1,
    history: []
  };

  let newOff;
  try {
    const result = await callCreateAction('officeReqs', officePayload);
    newOff = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.officeReqs.unshift(newOff);
  logSystemAction('OFFICE', 'CREATE_OFFICE_REQ', `Tạo đề xuất văn phòng [${code} - ${title}]`, 'SUCCESS', code);

  const newOffWfMap = getOfficeWorkflowMap(activeOfficeSubTab);
  const newOffApprovers = newOffWfMap[dept]?.approvers?.[1] || [];
  if (newOffApprovers.length) {
    notifyUsersByEmail('OFFICE', 'NOTIFY_APPROVAL_NEEDED', code, newOffApprovers,
      `[VPDT] Đề xuất văn phòng ${code} cần bạn phê duyệt`,
      `Đề xuất "${title}" (${code}) do ${currentUser.name} tạo đang chờ bạn phê duyệt.`);
  }

  alert('✅ Đã gửi đề xuất văn phòng thành công!');
  e.target.reset();
  document.getElementById('offCode').value = generateOfficeCode();
  if (isMuaSam) {
    officeItems = [];
    addOfficeItemRow();
  }
  renderOfficeReqs();
}

function onOfficeFilterChange() {
  resetListPage('office');
  renderOfficeReqs();
}

function filterOfficeByCard(status) {
  applyDashboardCardFilter({ filterStatusOffice: status }, 'office', renderOfficeReqs);
}

function renderOfficeReqs() {
  const tbody = document.getElementById('officeTableBody');
  if (!tbody) return;

  const deptFilter = document.getElementById('filterDeptOffice')?.value || '';
  const statusFilter = document.getElementById('filterStatusOffice')?.value || '';
  const fromDate = document.getElementById('filterFromDateOffice')?.value || '';
  const toDate = document.getElementById('filterToDateOffice')?.value || '';
  const keyword = (document.getElementById('filterKeywordOffice')?.value || '').trim();

  // CẬP NHẬT: lọc theo phạm vi Xem (officeView) thay vì hiển thị đề xuất của mọi phòng ban.
  const wfMapForFilter = getOfficeWorkflowMap(activeOfficeSubTab);
  const canViewOfficeReq = o => o.subType === activeOfficeSubTab && (
    scopeAllows(currentUser, currentUser.perms?.officeView, o.dept) ||
    o.creator === currentUser.username ||
    isApproverForDeptWorkflow(wfMapForFilter[o.dept], currentUser.username)
  );

  const scopedOfficeReqs = DB.officeReqs.filter(canViewOfficeReq);
  const officeDashCards = [
    { key: '', label: 'Tổng Đề Xuất', count: scopedOfficeReqs.length, colorClass: 'border-l-blue-500' },
    { key: 'PENDING', label: 'Đang Chờ Duyệt', count: scopedOfficeReqs.filter(o => o.status === 'PENDING').length, colorClass: 'border-l-yellow-500' },
    { key: 'APPROVED', label: 'Đã Phê Duyệt', count: scopedOfficeReqs.filter(o => o.status === 'APPROVED').length, colorClass: 'border-l-green-500' },
    { key: 'REJECTED', label: 'Bị Từ Chối', count: scopedOfficeReqs.filter(o => o.status === 'REJECTED').length, colorClass: 'border-l-red-500' }
  ];
  document.getElementById('officeDashboardCards').innerHTML = buildDashboardCardsHTML(officeDashCards, statusFilter, 'filterOfficeByCard');

  const list = DB.officeReqs.filter(o => {
    if (!canViewOfficeReq(o)) return false;

    if (deptFilter && o.dept !== deptFilter) return false;
    if (statusFilter && o.status !== statusFilter) return false;
    if (!isInDateRange(o.createdAt, fromDate, toDate)) return false;
    if (!matchesKeywordFields([o.code, o.title, o.creatorName], keyword)) return false;

    return true;
  });

  document.getElementById('paginationContainer_office').innerHTML = buildPaginationBoxHTML('office', 'renderOfficeReqs');
  const pageList = paginateList('office', list, 'renderOfficeReqs', 'đề xuất');

  if (pageList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center p-6 text-gray-500 italic">Không có đề xuất nào phù hợp.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageList.map(o => {
    const wfMap = getOfficeWorkflowMap(o.subType);
    const wfConfig = wfMap[o.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
    const wf = DB.workflows.find(w => w.id === wfConfig.workflowId) || { steps: [{ name: 'Sếp duyệt' }] };

    const currentStepApprovers = wfConfig.approvers ? (wfConfig.approvers[o.currentStep] || []) : [];
    const canApprove = (o.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, o.history, o.currentStep);

    let statusBadge = '';
    if (o.status === 'APPROVED') statusBadge = `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã phê duyệt</span>`;
    else if (o.status === 'REJECTED') statusBadge = `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Từ chối</span>`;
    else if (o.status === 'DRAFT') statusBadge = `<span class="px-2 py-0.5 bg-orange-100 text-orange-800 rounded font-bold text-xs">✏️ Cần bổ sung — chờ sửa lại</span>`;
    else statusBadge = `<span class="px-2 py-0.5 bg-teal-100 text-teal-800 rounded font-bold text-xs">⏳ Bước ${o.currentStep}/${wf.steps.length}${escapeHtml(getStepApprovalProgressText(currentStepApprovers, o.history, o.currentStep))}</span>`;

    const canDL = o.status === 'APPROVED' && canDownloadFile(currentUser, 'office', o.dept, o.creator);
    const paymentCell = o.status === 'APPROVED'
      ? `<span class="px-2 py-0.5 rounded font-bold text-xs ${CONTRACT_PAYMENT_BADGE_CLS[o.paymentStatus] || ''}">${CONTRACT_PAYMENT_LABELS[o.paymentStatus] || '-'}</span>${o.signedFileUrl ? '<div class="text-[10px] text-gray-500 mt-0.5">📎 Đã có tài liệu ký</div>' : ''}`
      : '<span class="text-gray-300">—</span>';

    return `
      <tr class="hover:bg-gray-50 border-b">
        <td class="border p-2 font-mono font-bold text-teal-800">${escapeHtml(o.code)}</td>
        <td class="border p-2 font-bold">${escapeHtml(o.subType)}</td>
        <td class="border p-2">${escapeHtml(o.dept)}<br><span class="text-xs text-gray-500">${escapeHtml(o.creatorName)}</span></td>
        <td class="border p-2">
          <div class="font-bold text-gray-800">${escapeHtml(o.title)}</div>
          <div class="text-xs text-gray-500">${Array.isArray(o.items) ? `${o.items.length} hạng mục` : `Số lượng: ${escapeHtml(o.qty)}`}</div>
        </td>
        <td class="border p-2">
          <div class="font-bold text-rose-600">${(o.amount || 0).toLocaleString('vi-VN')} VNĐ</div>
          <div class="text-xs text-gray-500">${Array.isArray(o.items) ? '' : `NCC: ${escapeHtml(o.supplier || 'N/A')}`}</div>
        </td>
        <td class="border p-2">${statusBadge}</td>
        <td class="border p-2">${paymentCell}</td>
        <td class="border p-2 text-center space-x-1">
          ${(() => {
            const primaryBtnHTML = canApprove
              ? `<button data-op="runOfficeAction" data-arg0="${o.id}" data-arg1="process" class="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs hover:opacity-90 font-bold">✍️ Xử lý / Duyệt</button>`
              : `<button data-op="runOfficeAction" data-arg0="${o.id}" data-arg1="process" class="px-2.5 py-1 bg-gray-600 text-white rounded text-xs hover:opacity-90 font-bold">👁️ Xem chi tiết</button>`;
            const secondaryOptions = [];
            if (o.status === 'APPROVED') {
              secondaryOptions.push({ value: 'viewSlip', label: '👁️ Xem Phiếu' });
              if (canDL) secondaryOptions.push({ value: 'downloadSlip', label: '⬇️ Tải' });
              if (o.signedFileUrl && canDL) secondaryOptions.push({ value: 'viewSigned', label: '👁️ Xem Tài Liệu Ký' });
              if (canManageOfficePaymentClient(currentUser, o)) {
                if (!o.signedFileUrl) secondaryOptions.push({ value: 'uploadSigned', label: '📤 Tải Tài Liệu Ký' });
                else if (o.paymentStatus === 'CHUA_THANH_TOAN') secondaryOptions.push({ value: 'startPayment', label: '💰 Chuyển Sang Thanh Toán' });
              }
            }
            // "Sửa & Gửi Lại" — chỉ chính người tạo, chỉ khi đang cần bổ sung (NHÁP do
            // confirmProcessOfficeReq('REQUEST_CHANGES'), xem openBosungEditModal()).
            if (o.status === 'DRAFT' && o.creator === currentUser.username) {
              secondaryOptions.push({ value: 'editDraft', label: '✏️ Sửa & Gửi Lại' });
            }
            if (currentUser.perms?.admin) secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });
            return buildActionCell(o.id, primaryBtnHTML, secondaryOptions, 'runOfficeAction');
          })()}
        </td>
      </tr>
    `;
  }).join('');
}

// Hàm điều phối cho khối "Thao Tác" của Phê duyệt Văn phòng (xem buildActionCell()).
function runOfficeAction(id, action) {
  switch (action) {
    case 'process': openOfficeProcessModal(id); break;
    case 'viewSlip': viewOfficeApprovalSlip(id); break;
    case 'downloadSlip': downloadOfficeApprovalSlip(id); break;
    case 'editDraft': openBosungEditModal('officeReqs', id); break;
    case 'uploadSigned': openSignedUploadModal('officeReqs', id); break;
    case 'viewSigned': viewOfficeSignedFile(id); break;
    case 'startPayment': startOfficePaymentAction(id); break;
    case 'delete': deleteOfficeReqAction(id); break;
  }
}

function deleteOfficeReqAction(id) {
  const o = DB.officeReqs.find(x => x.id === id);
  if (!o) return;
  deleteRecordAdminOnly('officeReqs', id, `đề xuất ${o.code}`, () => {
    DB.officeReqs = DB.officeReqs.filter(x => x.id !== id);
    logSystemAction('OFFICE', 'DELETE_OFFICE_REQ', `Xóa đề xuất văn phòng [${o.code} - ${o.title}]`, 'SUCCESS', o.code);
    renderOfficeReqs();
  });
}

function openOfficeProcessModal(officeId) {
  currentProcessingOfficeId = officeId;
  const o = DB.officeReqs.find(item => item.id === officeId);
  if (!o) return;

  const wfMap = getOfficeWorkflowMap(o.subType);
  const wfConfig = wfMap[o.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const wf = DB.workflows.find(w => w.id === wfConfig.workflowId) || { steps: [{ name: 'Sếp duyệt' }] };

  document.getElementById('officeModalTitle').innerText = `🏢 Xử Lý Đề Xuất Văn Phòng: ${o.title} (${o.code})`;
  document.getElementById('officeModalSub').innerText = `Phân hệ: ${o.subType} | Phòng ban: ${o.dept} | Người tạo: ${o.creatorName}`;

  let detailsHTML = `
    <div class="grid grid-cols-2 gap-2 text-xs">
      <div><b>Ngày tạo:</b> ${escapeHtml(o.createdAt)}</div>
      ${Array.isArray(o.items)
        ? `<div><b>Thời gian cần sử dụng:</b> ${escapeHtml(o.usageTime || 'N/A')}</div>`
        : `<div><b>Số lượng:</b> ${escapeHtml(o.qty)}</div>`}
      <div><b>Giá trị dự kiến:</b> ${o.amount.toLocaleString('vi-VN')} VNĐ</div>
      ${Array.isArray(o.items) ? '' : `<div><b>Nhà cung cấp:</b> ${escapeHtml(o.supplier || 'N/A')}</div>`}
      <div class="col-span-2"><b>Lý do / Diễn giải:</b> <p class="bg-white p-2 rounded border mt-1">${escapeHtml(o.reason)}</p></div>
    </div>
  `;

  if (Array.isArray(o.items)) {
    detailsHTML += `
      <div class="border-t pt-2 mt-2">
        <div class="font-semibold mb-1">Danh sách hạng mục (theo Mẫu BM-TS01):</div>
        <div class="overflow-x-auto">
          <table class="w-full border-collapse border text-xs bg-white">
            <thead><tr class="bg-gray-100 text-left">
              <th class="border p-1">STT</th><th class="border p-1">Tên tài sản</th><th class="border p-1">Model</th>
              <th class="border p-1">ĐVT</th><th class="border p-1">SL</th><th class="border p-1">Đơn giá</th>
              <th class="border p-1">Thành tiền</th><th class="border p-1">Ghi chú</th>
            </tr></thead>
            <tbody>
              ${o.items.map((it, idx) => `
                <tr>
                  <td class="border p-1 text-center">${idx + 1}</td>
                  <td class="border p-1">${escapeHtml(it.name)}</td>
                  <td class="border p-1">${escapeHtml(it.model || '')}</td>
                  <td class="border p-1">${escapeHtml(it.unit || '')}</td>
                  <td class="border p-1 text-right">${it.qty}</td>
                  <td class="border p-1 text-right">${(it.unitPrice || 0).toLocaleString('vi-VN')}</td>
                  <td class="border p-1 text-right font-semibold">${(it.amount || 0).toLocaleString('vi-VN')}</td>
                  <td class="border p-1">${escapeHtml(it.note || '')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  if (o.customData && Object.keys(o.customData).length > 0) {
    detailsHTML += `<div class="border-t pt-2 mt-2 font-semibold">Trường dữ liệu mở rộng:</div><div class="grid grid-cols-2 gap-2 text-xs">`;
    for (let key in o.customData) {
      detailsHTML += `<div><b>${escapeHtml(key)}:</b> ${escapeHtml(o.customData[key])}</div>`;
    }
    detailsHTML += `</div>`;
  }

  document.getElementById('officeModalDetails').innerHTML = detailsHTML;
  document.getElementById('txtOfficeComment').value = '';

  const historyHTML = (o.history || []).map(h => `
    <div class="bg-white p-2 rounded border text-xs space-y-1">
      <div class="flex justify-between font-bold text-gray-700">
        <span>${escapeHtml(h.approver)} (${escapeHtml(h.username)})</span>
        <span class="text-gray-400 font-normal">${escapeHtml(h.time)}</span>
      </div>
      <div class="text-gray-600">Hành động: <span class="font-bold text-blue-600">${escapeHtml(h.action)}</span> — Bước ${h.step}${h.stepName ? ` (${escapeHtml(h.stepName)})` : ''}</div>
      ${h.comment ? `<div class="text-gray-800 bg-amber-50 p-1.5 rounded border italic">"${escapeHtml(h.comment)}"</div>` : ''}
    </div>
  `).join('');
  document.getElementById('officeModalHistory').innerHTML = historyHTML || '<div class="text-gray-400 italic">Chưa có lịch sử xử lý.</div>';

  const currentStepApprovers = wfConfig.approvers ? (wfConfig.approvers[o.currentStep] || []) : [];
  const canApprove = (o.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, o.history, o.currentStep);

  const actionBtns = document.getElementById('officeModalActionBtns');
  if (canApprove) {
    actionBtns.innerHTML = `
      <button data-op="confirmProcessOfficeReq" data-arg0="REJECT" class="bg-red-600 text-white px-4 py-1.5 rounded font-bold hover:bg-red-700 text-xs">❌ Từ Chối</button>
      <button data-op="confirmProcessOfficeReq" data-arg0="REQUEST_CHANGES" class="bg-amber-500 text-white px-4 py-1.5 rounded font-bold hover:bg-amber-600 text-xs">🔄 Bổ Sung</button>
      <button data-op="confirmProcessOfficeReq" data-arg0="APPROVE" class="bg-green-600 text-white px-5 py-1.5 rounded font-bold hover:bg-green-700 text-xs">✅ Phê Duyệt & Chuyển Bước</button>
    `;
  } else {
    actionBtns.innerHTML = `<span class="text-gray-500 italic text-xs">Bạn chỉ có quyền xem thông tin đề xuất này.</span>`;
  }

  document.getElementById('officeProcessModal').classList.remove('hidden');
}

function closeOfficeProcessModal() {
  document.getElementById('officeProcessModal').classList.add('hidden');
  currentProcessingOfficeId = null;
}

function confirmProcessOfficeReq(actionType) {
  const comment = document.getElementById('txtOfficeComment').value.trim();
  if ((actionType === 'REJECT' || actionType === 'REQUEST_CHANGES') && !comment) {
    return alert(actionType === 'REJECT' ? 'Vui lòng nhập lý do từ chối vào ô Ý kiến chỉ đạo!' : 'Vui lòng nhập lý do cần bổ sung vào ô Ý kiến chỉ đạo!');
  }
  const isApprove = actionType === 'APPROVE';
  const titleMap = { APPROVE: '✅ Xác Nhận Phê Duyệt', REJECT: '❌ Xác Nhận Từ Chối', REQUEST_CHANGES: '🔄 Xác Nhận Yêu Cầu Bổ Sung' };
  const labelMap = { APPROVE: 'Phê Duyệt', REJECT: 'Từ Chối', REQUEST_CHANGES: 'Yêu Cầu Bổ Sung' };
  const actionTextMap = { APPROVE: 'phê duyệt và chuyển bước', REJECT: 'từ chối', REQUEST_CHANGES: 'yêu cầu bổ sung (đưa đề xuất về nháp để người tạo sửa lại)' };
  showConfirmModal({
    title: titleMap[actionType],
    bodyHTML: `<p>Bạn có chắc chắn muốn <b>${actionTextMap[actionType]}</b> đề xuất này?</p>${comment ? `<p class="mt-2 italic text-gray-600">Ý kiến: "${escapeHtml(comment)}"</p>` : ''}`,
    confirmLabel: labelMap[actionType],
    onConfirm: () => {
      if (isApprove) withApprovalAuth(() => processOfficeReq('APPROVE'));
      else processOfficeReq(actionType);
    }
  });
}

async function processOfficeReq(actionType) {
  if (!currentProcessingOfficeId) return;
  const o = DB.officeReqs.find(item => item.id === currentProcessingOfficeId);
  if (!o) return;

  const comment = document.getElementById('txtOfficeComment').value.trim();
  if ((actionType === 'REJECT' || actionType === 'REQUEST_CHANGES') && !comment) {
    return alert(actionType === 'REJECT' ? 'Vui lòng nhập lý do từ chối vào ô Ý kiến chỉ đạo!' : 'Vui lòng nhập lý do cần bổ sung vào ô Ý kiến chỉ đạo!');
  }

  const actionUrlMap = { APPROVE: 'approve', REJECT: 'reject', REQUEST_CHANGES: 'request-changes' };
  let result;
  try {
    result = await callWorkflowAction('officeReqs', o.id, actionUrlMap[actionType], { comment });
  } catch (e) {
    return alert('⛔ ' + e.message);
  }

  const updatedOffice = result.item;
  const transition = result.transition;
  const idx = DB.officeReqs.findIndex(item => item.id === o.id);
  if (idx !== -1) DB.officeReqs[idx] = updatedOffice;

  let msg = '✅ Đã cập nhật trạng thái đề xuất văn phòng!';

  if (transition.type === 'REQUEST_CHANGES') {
    notifyUsersByEmail('OFFICE', 'NOTIFY_REQUEST_CHANGES', updatedOffice.code, [updatedOffice.creator],
      `[VPDT] Đề xuất văn phòng ${updatedOffice.code} cần bổ sung/chỉnh sửa`,
      `Đề xuất "${updatedOffice.title}" (${updatedOffice.code}) của bạn cần được sửa lại. Lý do: ${comment}. Vui lòng vào mục Văn Phòng Tổng Hợp để sửa và gửi lại.`);
    msg = '✅ Đã yêu cầu bổ sung — hồ sơ đã chuyển về NHÁP để người tạo sửa lại!';
  } else if (transition.type === 'REJECTED') {
    notifyUsersByEmail('OFFICE', 'NOTIFY_REJECTED', updatedOffice.code, [updatedOffice.creator],
      `[VPDT] Đề xuất văn phòng ${updatedOffice.code} bị từ chối`,
      `Đề xuất "${updatedOffice.title}" (${updatedOffice.code}) của bạn đã bị từ chối. Lý do: ${comment}`);
  } else if (transition.type === 'ADVANCED') {
    msg = getStepAdvanceMessage(transition.stepApprovers);
    if (transition.nextApprovers.length) {
      notifyUsersByEmail('OFFICE', 'NOTIFY_APPROVAL_NEEDED', updatedOffice.code, transition.nextApprovers,
        `[VPDT] Đề xuất văn phòng ${updatedOffice.code} cần bạn phê duyệt`,
        `Đề xuất "${updatedOffice.title}" (${updatedOffice.code}) đang chờ bạn phê duyệt ở bước "${transition.nextStepName}".`);
    }
  } else if (transition.type === 'COMPLETED') {
    msg = '✅ Phê duyệt đề xuất văn phòng thành công!';
    notifyUsersByEmail('OFFICE', 'NOTIFY_APPROVED', updatedOffice.code, [updatedOffice.creator],
      `[VPDT] Đề xuất văn phòng ${updatedOffice.code} đã được phê duyệt`,
      `Đề xuất "${updatedOffice.title}" (${updatedOffice.code}) của bạn đã được phê duyệt hoàn tất.`);
  } else if (transition.type === 'PARTIAL_APPROVE') {
    msg = '✅ Đã ghi nhận phê duyệt của bạn — đang chờ các đồng phê duyệt còn lại ở bước này.';
  }

  logSystemAction('OFFICE', `PROCESS_${actionType}`, `Xử lý đề xuất văn phòng [${updatedOffice.code}]: ${actionType}`, 'SUCCESS', updatedOffice.code);
  alert(msg);
  closeOfficeProcessModal();
  renderOfficeReqs();
  refreshApprovalSurfaces();
}

