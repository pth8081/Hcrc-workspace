// ==========================================
// HỖ TRỢ IT — "🏷️ Phê Duyệt Giá" (duyệt giá bán mặt hàng siêu thị theo phòng ban, dùng chung engine
// dept-workflow ở lib/workflowEngine.js — xem docs/carRegs) + "🎫 Hỗ Trợ Yêu Cầu" (ticket helpdesk IT
// nội bộ, mở cho toàn bộ nhân viên, state machine đơn giản TODO->DOING->DONE/CANCELLED, không qua
// duyệt). 2 sub-module tách biệt hoàn toàn dữ liệu (xem lib/createValidation.js, không chung 1 công
// việc nghiệp vụ nào).
// ==========================================
let activeItSupportSubTab = 'PRICE';

function setItSupportSubTab(subTab) {
  window.scrollTo({ top: 0, behavior: 'auto' }); // Tránh "bay xuống cuối" khi đổi tab con — xem setSystemSubTab().
  activeItSupportSubTab = subTab;
  document.getElementById('itSubPrice').classList.toggle('hidden', subTab !== 'PRICE');
  document.getElementById('itSubTicket').classList.toggle('hidden', subTab !== 'TICKET');
  document.getElementById('itSubRenewal').classList.toggle('hidden', subTab !== 'RENEWAL');
  const activeCls = 'px-3 py-1.5 rounded text-xs font-bold bg-sky-700 text-white';
  const inactiveCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  document.getElementById('btnItSubPrice').className = subTab === 'PRICE' ? activeCls : inactiveCls;
  document.getElementById('btnItSubTicket').className = subTab === 'TICKET' ? activeCls : inactiveCls;
  document.getElementById('btnItSubRenewal').className = (subTab === 'RENEWAL' ? activeCls : inactiveCls) + (canManageItSupportClient(currentUser) ? '' : ' hidden');

  if (subTab === 'PRICE') {
    const canCreate = canProposeItPrice(currentUser);
    document.getElementById('itPriceCreateForm').classList.toggle('hidden', !canCreate);
    document.getElementById('itPriceNoCreatePermNote').classList.toggle('hidden', canCreate);
    document.getElementById('itPriceMasterListAdminWrap').classList.toggle('hidden', !currentUser.perms?.admin);
    if (currentUser.perms?.admin) renderItPriceMasterListAdmin();
    if (canCreate) {
      document.getElementById('itPriceCode').value = generateItPriceCode();
      document.getElementById('itPriceDeptDisplay').value = currentUser.dept;
      itPricePendingFile = null;
      document.getElementById('itPriceFileStatus').innerText = '';
      document.getElementById('itPriceFilePreviewWrap').classList.add('hidden');
      const fileInput = document.getElementById('itPriceFileInput');
      if (fileInput) fileInput.value = '';
      renderItPriceMasterListSelect();
    }
    renderItPriceApprovals();
  }
  if (subTab === 'TICKET') {
    document.getElementById('itTicketCode').value = generateItTicketCode();
    renderItTickets();
  }
  if (subTab === 'RENEWAL') {
    renderItServiceRenewals();
  }
}

// ----- 🏷️ Phê Duyệt Giá -----
// Đề xuất giờ nộp bằng cách tải lên 1 tệp Excel bảng giá (nhiều dòng/mặt hàng cùng lúc, xem
// lib/priceFileParser.js) thay vì nhập tay 1 mặt hàng — đọc + xem trước ngay ở form tạo (parse-file),
// rồi echo lại kết quả kèm request tạo (giống hệt luồng danh mục VPP ở onVppCatalogFileChange()).
let itPricePendingFile = null; // { items, fileUrl, fileName } — kết quả đọc file gần nhất, chờ gửi

// Hiển thị bảng xem trước ĐÚNG theo tên cột của Mẫu Giá đã chọn (data.columnLabels, do server trả về từ
// POST /api/it-price/parse-file — xem lib/priceFileParser.js) — mỗi dòng chỉ còn 1 object `it.values`
// generic (key = key cột, value = nội dung ô nguyên văn dạng chuỗi), KHÔNG còn khái niệm cột nào là
// "tên"/"giá" (đã bỏ hẳn — xem ghi chú đầu lib/priceFileParser.js). Khi chưa chọn Mẫu Giá nào, columnLabels
// là bộ nhãn mặc định (DEFAULT_COLUMN_LABELS ở server).
function itPriceCellHTML(it, col) {
  return escapeHtml(it.values?.[col.key] || '');
}

function renderItPriceFilePreview(data) {
  const columnLabels = data.columnLabels && data.columnLabels.length ? data.columnLabels : [{ key: 'c0', label: 'Dữ liệu' }];
  document.getElementById('itPriceFilePreviewCount').innerText = data.items.length;
  document.getElementById('itPriceFilePreviewHead').innerHTML = `<tr>${columnLabels.map(col =>
    `<th class="border p-1">${escapeHtml(col.label)}</th>`
  ).join('')}</tr>`;
  document.getElementById('itPriceFilePreviewBody').innerHTML = data.items.map(it => `<tr>${columnLabels.map(col =>
    `<td class="border p-1">${itPriceCellHTML(it, col)}</td>`
  ).join('')}</tr>`).join('');
  document.getElementById('itPriceFilePreviewWrap').classList.remove('hidden');
}

async function parseItPriceFileForPreview(file) {
  const statusEl = document.getElementById('itPriceFileStatus');
  statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  const masterListId = document.getElementById('itPriceMasterListSelect')?.value;
  if (masterListId) formData.append('masterListId', masterListId);
  try {
    const res = await fetch('/api/it-price/parse-file', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    itPricePendingFile = data;
    statusEl.innerText = `✅ Đọc thành công ${data.items.length} dòng giá từ file "${data.fileName}".`;
    renderItPriceFilePreview(data);
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
  }
}

async function onItPriceFileChange(event) {
  const file = event.target.files[0];
  itPricePendingFile = null;
  document.getElementById('itPriceFilePreviewWrap').classList.add('hidden');
  const statusEl = document.getElementById('itPriceFileStatus');
  if (!file) { statusEl.innerText = ''; return; }
  await parseItPriceFileForPreview(file);
  if (!itPricePendingFile) event.target.value = '';
}

// Đổi Mẫu Giá SAU KHI đã chọn sẵn 1 tệp bảng giá — đọc lại tệp đó (còn nguyên trong ô chọn file) để dò
// lại đúng cột theo mẫu mới chọn, không bắt người dùng phải chọn lại tệp.
async function onItPriceMasterListChange() {
  updateItPriceMasterListDownloadLink();
  const fileInput = document.getElementById('itPriceFileInput');
  const file = fileInput?.files?.[0];
  if (!file) return;
  await parseItPriceFileForPreview(file);
}

// Cập nhật link "Tải Mẫu Giá này về" ngay dưới dropdown chọn mẫu trong form tạo đề xuất — để người đề
// xuất tải đúng file mẫu (khuôn cột) đang chọn về làm theo trước khi nộp bảng giá của mình.
function updateItPriceMasterListDownloadLink() {
  const link = document.getElementById('itPriceMasterListDownloadLink');
  if (!link) return;
  const masterListId = document.getElementById('itPriceMasterListSelect')?.value;
  const list = masterListId ? (DB.itPriceMasterLists || []).find(m => String(m.id) === masterListId) : null;
  if (!list) { link.classList.add('hidden'); return; }
  link.href = attachmentDownloadUrl(list.fileUrl, null, list.fileName);
  link.classList.remove('hidden');
}

// ============ Modal dùng chung "Gán vai trò cột" ============
// Dùng khi đọc xong 1 file Excel BẤT KỲ (không "nhận diện" cột theo từ khoá nữa) — hiện danh sách cột
// đọc được, người dùng tự chọn cột nào ứng với từng vai trò nghiệp vụ bắt buộc/tuỳ chọn. Trả về Promise
// resolve {picked: {roleKey: colIdx}, extraIdx: [colIdx chưa gán vai trò nào]} hoặc null nếu bấm Hủy.
// columns: mảng string (nhãn cột, đúng thứ tự trong file) — roles: [{key,label,required}].
let colRoleModalState = null;
function openColumnRoleMappingModal(columns, { title, hint, roles }) {
  return new Promise((resolve) => {
    colRoleModalState = { columns, roles, resolve };
    document.getElementById('colRoleModalTitle').innerText = title || 'Gán vai trò cột';
    document.getElementById('colRoleModalHint').innerText = hint || `File có ${columns.length} cột: ${columns.join(', ')}.`;
    const optionsHTML = `<option value="">-- Không có --</option>` + columns.map((c, i) => `<option value="${i}">${escapeHtml(c)}</option>`).join('');
    document.getElementById('colRoleModalFields').innerHTML = roles.map(r => `
      <div>
        <label class="block font-semibold text-gray-600 mb-1">${escapeHtml(r.label)}${r.required ? ' <span class="text-red-500">*</span>' : ''}</label>
        <select id="colRoleSel_${r.key}" class="w-full border p-1.5 rounded bg-white"></select>
      </div>
    `).join('');
    roles.forEach(r => { document.getElementById(`colRoleSel_${r.key}`).innerHTML = optionsHTML; });
    document.getElementById('colRoleModal').classList.remove('hidden');
  });
}
function closeColRoleModal(result) {
  document.getElementById('colRoleModal').classList.add('hidden');
  const resolve = colRoleModalState?.resolve;
  colRoleModalState = null;
  if (resolve) resolve(result);
}
function confirmColRoleModal() {
  const { columns, roles } = colRoleModalState;
  const picked = {};
  const usedIdx = new Set();
  for (const r of roles) {
    const val = document.getElementById(`colRoleSel_${r.key}`).value;
    if (val === '') {
      if (r.required) return alert(`Vui lòng chọn cột cho "${r.label}".`);
      continue;
    }
    const idx = Number(val);
    if (usedIdx.has(idx)) return alert(`Cột "${columns[idx]}" đã được gán cho vai trò khác — mỗi cột chỉ gán được 1 vai trò.`);
    usedIdx.add(idx);
    picked[r.key] = idx;
  }
  const extraIdx = columns.map((_, i) => i).filter(i => !usedIdx.has(i));
  closeColRoleModal({ picked, extraIdx });
}

// ============ Mẫu Giá (khuôn cột) — quản lý (chỉ admin, xem itPriceMasterListAdminWrap) ============
// Mỗi thao tác (thêm/thay file/xoá) LƯU NGAY sau khi xong — khác kiểu draft-rồi-bấm-Lưu-1-lần của
// "Nhóm Không Cấp Văn Phòng Phẩm" vì mỗi thao tác ở đây vốn đã là 1 round-trip server riêng (đọc/parse
// file), không có nhiều field rời rạc cần gộp lại thành 1 lượt lưu. KHÔNG còn bước "Gán vai trò cột"
// (đã bỏ hẳn khái niệm giá cũ/giá mới cho Mẫu Giá) — cột đọc được từ file mẫu LẤY NGUYÊN VĂN, lưu thẳng.
function renderItPriceMasterListAdmin() {
  const tbody = document.getElementById('itPriceMasterListTableBody');
  if (!tbody) return;
  const lists = DB.itPriceMasterLists || [];
  if (!lists.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center p-4 text-gray-400 italic">Chưa có Mẫu Giá nào — bấm "+ Thêm Mẫu Giá" để nạp.</td></tr>`;
    return;
  }
  tbody.innerHTML = lists.map(m => `
    <tr class="hover:bg-gray-50 border-b">
      <td class="border p-2 font-semibold">${escapeHtml(m.name)}<br><a href="${attachmentDownloadUrl(m.fileUrl, null, m.fileName)}" target="_blank" class="text-[11px] text-sky-600 hover:underline font-normal">📥 ${escapeHtml(m.fileName || '')}</a></td>
      <td class="border p-2">${(m.columns || []).map(c => `<span class="inline-block px-1.5 py-0.5 rounded text-[11px] mr-1 mb-1 bg-gray-100 text-gray-700">${escapeHtml(c.label)}</span>`).join('')}</td>
      <td class="border p-2">${escapeHtml(m.uploadedByName || '')}<br><span class="text-[11px] text-gray-400">${escapeHtml(m.uploadedAt || '')}</span></td>
      <td class="border p-2 text-center space-x-1 whitespace-nowrap">
        <button type="button" data-op="renameItPriceMasterList" data-arg0="${m.id}" class="px-2 py-1 bg-gray-200 text-gray-700 rounded text-[11px] font-bold hover:bg-gray-300">✏️ Đổi tên</button>
        <button type="button" data-op="replaceItPriceMasterListFile" data-arg0="${m.id}" class="px-2 py-1 bg-sky-600 text-white rounded text-[11px] font-bold hover:bg-sky-700">🔄 Thay mẫu</button>
        <button type="button" data-op="deleteItPriceMasterList" data-arg0="${m.id}" class="px-2 py-1 bg-red-600 text-white rounded text-[11px] font-bold hover:bg-red-700">🗑️ Xoá</button>
      </td>
    </tr>
  `).join('');
}

// Đọc + parse 1 file Excel mẫu qua route riêng (admin-only) — CHỈ trả về khuôn cột (columns), không có
// dữ liệu — Promise<{columns,fileUrl,fileName}> hoặc null nếu người dùng bấm Hủy chọn file/có lỗi (đã
// tự alert).
function pickAndParseMasterListFile() {
  return new Promise((resolve) => {
    const input = document.getElementById('itPriceMasterListFileInput');
    input.value = '';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return resolve(null);
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await fetch('/api/it-price/master-list/parse-file', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
        resolve(data);
      } catch (err) {
        alert(`⛔ ${err.message}`);
        resolve(null);
      }
    };
    input.click();
  });
}

function itPriceColumnListText(columns) {
  return (columns || []).map(c => c.label).join(', ');
}

async function addItPriceMasterList() {
  const parsed = await pickAndParseMasterListFile();
  if (!parsed) return;
  const name = prompt(`Nhập Tên Mẫu Giá (VD: "Mẫu giá Q3/2026", "Mẫu giá ngành thực phẩm"):`);
  if (name === null) return;
  if (!name.trim()) return alert('Vui lòng nhập tên mẫu giá.');

  const entry = {
    id: Date.now(), name: name.trim(),
    fileUrl: parsed.fileUrl, fileName: parsed.fileName, columns: parsed.columns,
    uploadedBy: currentUser.username, uploadedByName: currentUser.name,
    uploadedAt: new Date().toLocaleString('vi-VN')
  };
  const snapshot = [...(DB.itPriceMasterLists || [])];
  DB.itPriceMasterLists = [...snapshot, entry];
  const saved = await syncStorage('itPriceMasterLists');
  if (!saved) { DB.itPriceMasterLists = snapshot; return; }
  logSystemAction('IT_SUPPORT', 'ADD_IT_PRICE_MASTER_LIST', `Thêm Mẫu Giá "${entry.name}" (${entry.columns.length} cột)`, 'SUCCESS');
  alert(`✅ Đã thêm Mẫu Giá "${entry.name}" (${entry.columns.length} cột).`);
  renderItPriceMasterListAdmin();
}

async function replaceItPriceMasterListFile(id) {
  const list = (DB.itPriceMasterLists || []).find(m => m.id === id);
  if (!list) return;
  if (!confirm(`Thay mẫu mới cho "${list.name}"? Khuôn cột hiện tại (${itPriceColumnListText(list.columns)}) sẽ bị THAY THẾ hoàn toàn.`)) return;
  const parsed = await pickAndParseMasterListFile();
  if (!parsed) return;

  const snapshot = [...(DB.itPriceMasterLists || [])];
  DB.itPriceMasterLists = snapshot.map(m => m.id === id ? {
    ...m, fileUrl: parsed.fileUrl, fileName: parsed.fileName, columns: parsed.columns,
    uploadedBy: currentUser.username, uploadedByName: currentUser.name, uploadedAt: new Date().toLocaleString('vi-VN')
  } : m);
  const saved = await syncStorage('itPriceMasterLists');
  if (!saved) { DB.itPriceMasterLists = snapshot; return; }
  logSystemAction('IT_SUPPORT', 'REPLACE_IT_PRICE_MASTER_LIST', `Thay mẫu Mẫu Giá "${list.name}" (${parsed.columns.length} cột)`, 'SUCCESS');
  alert(`✅ Đã cập nhật "${list.name}" (${parsed.columns.length} cột).`);
  renderItPriceMasterListAdmin();
}

async function renameItPriceMasterList(id) {
  const list = (DB.itPriceMasterLists || []).find(m => m.id === id);
  if (!list) return;
  const name = prompt('Tên mới cho Mẫu Giá:', list.name);
  if (name === null) return;
  if (!name.trim()) return alert('Vui lòng nhập tên mẫu giá.');
  const snapshot = [...(DB.itPriceMasterLists || [])];
  DB.itPriceMasterLists = snapshot.map(m => m.id === id ? { ...m, name: name.trim() } : m);
  const saved = await syncStorage('itPriceMasterLists');
  if (!saved) { DB.itPriceMasterLists = snapshot; return; }
  renderItPriceMasterListAdmin();
}

async function deleteItPriceMasterList(id) {
  const list = (DB.itPriceMasterLists || []).find(m => m.id === id);
  if (!list) return;
  if (!confirm(`Xoá Mẫu Giá "${list.name}"? Các đề xuất đã nộp trước đây theo mẫu này vẫn giữ nguyên (đã lưu sẵn tên cột lúc nộp) — chỉ những đề xuất MỚI sau này không còn chọn được mẫu này nữa.`)) return;
  const snapshot = [...(DB.itPriceMasterLists || [])];
  DB.itPriceMasterLists = snapshot.filter(m => m.id !== id);
  const saved = await syncStorage('itPriceMasterLists');
  if (!saved) { DB.itPriceMasterLists = snapshot; return; }
  logSystemAction('IT_SUPPORT', 'DELETE_IT_PRICE_MASTER_LIST', `Xoá Mẫu Giá "${list.name}"`, 'SUCCESS');
  renderItPriceMasterListAdmin();
  renderItPriceMasterListSelect();
}

// Dropdown "Mẫu Giá Phê Duyệt" ở form tạo đề xuất — MỌI người đề xuất thấy được (không riêng admin,
// khác itPriceMasterListAdminWrap ở trên), tự ẩn hẳn nếu chưa có mẫu nào để đỡ rối form.
function renderItPriceMasterListSelect() {
  const wrap = document.getElementById('itPriceMasterListSelectWrap');
  const select = document.getElementById('itPriceMasterListSelect');
  if (!wrap || !select) return;
  const lists = DB.itPriceMasterLists || [];
  wrap.classList.toggle('hidden', lists.length === 0);
  if (!lists.length) return;
  const prevValue = select.value;
  select.innerHTML = `<option value="">-- Chọn Mẫu Giá Phê Duyệt --</option>` +
    lists.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${(m.columns || []).length} cột)</option>`).join('');
  if (lists.some(m => String(m.id) === prevValue)) select.value = prevValue;
  updateItPriceMasterListDownloadLink();
}

async function submitItPriceApproval(e) {
  e.preventDefault();
  const code = document.getElementById('itPriceCode').value.trim();
  if (DB.itPriceApprovals.some(p => p.code === code)) {
    return alert('Mã đề xuất đã tồn tại!');
  }
  if (!itPricePendingFile) return alert('Vui lòng chọn tệp bảng giá (.xlsx) cần duyệt!');
  const masterListId = document.getElementById('itPriceMasterListSelect')?.value || null;
  // Đã có Mẫu Giá nào trong hệ thống thì bắt buộc chọn đúng 1 mẫu (server tự xác minh lại y hệt ở
  // itPriceApprovals.extraValidate — đây chỉ là chặn sớm cho trải nghiệm mượt, không phải nguồn quyết
  // định). Cấu trúc cột đã được server kiểm tra + gắn columnLabels ngay lúc đọc file ở
  // parseItPriceFileForPreview() (POST /api/it-price/parse-file), itPricePendingFile chỉ echo lại kết
  // quả đó.
  if ((DB.itPriceMasterLists || []).length && !masterListId) {
    return alert('⛔ Vui lòng chọn Mẫu Giá Phê Duyệt trước khi gửi đề xuất.');
  }
  // Bán Buôn (mục B) — bắt buộc chọn đúng 1 trong 4 mức Margin/Chiết Khấu, chặn sớm cho trải nghiệm
  // mượt (server tự xác minh lại y hệt ở itPriceApprovals.extraValidate, không tin giá trị client gửi).
  if (activeItPriceSubTab === 'WHOLESALE' && !document.getElementById('itPriceTier').value) {
    return alert('⛔ Vui lòng chọn Mức Margin/Chiết Khấu áp dụng.');
  }
  // Tài liệu bổ sung liên quan (mục A, mirror ĐÚNG extraFilesInput/extraFiles của doSubmitSubmissionReq())
  // — hoàn toàn TUỲ CHỌN, mảng rỗng nếu không chọn tệp nào.
  const extraFilesInput = document.getElementById('itPriceExtraFiles');
  let extraFiles = [];
  if (extraFilesInput.files && extraFilesInput.files.length > 0) {
    try {
      extraFiles = await Promise.all(Array.from(extraFilesInput.files).map(f => uploadFileToServer(f, 'itPrice')));
    } catch (err) {
      return alert(`⛔ Tải tài liệu bổ sung thất bại: ${err.message}`);
    }
  }
  const payload = {
    code,
    // Tự động gắn đúng priceType theo sub-tab con đang mở (KHÔNG có dropdown chọn tay — mục 1 kế
    // hoạch) — server tự xác minh lại giá trị hợp lệ ở itPriceApprovals.extraValidate.
    priceType: activeItPriceSubTab,
    priceTier: activeItPriceSubTab === 'WHOLESALE' ? document.getElementById('itPriceTier').value : null,
    masterListId: masterListId ? Number(masterListId) : null,
    files: [{
      fileUrl: itPricePendingFile.fileUrl, fileName: itPricePendingFile.fileName,
      items: itPricePendingFile.items, columnLabels: itPricePendingFile.columnLabels
    }],
    extraFiles,
    reason: document.getElementById('itPriceReason').value.trim(),
    createdAt: new Date().toLocaleString('vi-VN')
  };

  let newItem;
  try {
    const result = await callCreateAction('itPriceApprovals', payload);
    newItem = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.itPriceApprovals.unshift(newItem);
  logSystemAction('IT_SUPPORT', 'CREATE_IT_PRICE_APPROVAL', `Tạo đề xuất duyệt giá [${code}]`, 'SUCCESS', code);

  // Mọi đề xuất giờ LUÔN đi qua đúng quy trình duyệt (phòng ban cho RETAIL, theo tier cho WHOLESALE —
  // mục B, xem resolveItPriceWorkflowConfigForItemClient()). Không còn nhánh autoApproved — xem
  // itPriceApprovals.extraValidate ở lib/createValidation.js).
  const wfConfig = resolveItPriceWorkflowConfigForItemClient(newItem);
  const firstStepApprovers = wfConfig?.approvers?.[1] || [];
  if (firstStepApprovers.length) {
    notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_APPROVAL_NEEDED', code, firstStepApprovers,
      `[VPDT] Đề xuất duyệt giá ${code} cần bạn phê duyệt`,
      `Đề xuất duyệt giá (${code}) do ${currentUser.name} đề xuất đang chờ bạn phê duyệt.`);
  }
  alert('✅ Đã gửi đề xuất duyệt giá thành công!');

  e.target.reset();
  itPricePendingFile = null;
  document.getElementById('itPriceFileStatus').innerText = '';
  document.getElementById('itPriceFilePreviewWrap').classList.add('hidden');
  document.getElementById('itPriceCode').value = generateItPriceCode();
  document.getElementById('itPriceDeptDisplay').value = currentUser.dept;
  document.getElementById('itPriceTier').value = '';
  renderItPriceMasterListSelect();
  renderItPriceApprovals();
}

function onItPriceFilterChange() {
  resetListPage('itPrice');
  renderItPriceApprovals();
}

function filterItPriceByCard(status) {
  applyDashboardCardFilter({ filterStatusItPrice: status }, 'itPrice', renderItPriceApprovals);
}

// Sub-tab con "Bán Lẻ"/"Bán Buôn" (mục 1 kế hoạch) — mặc định RETAIL. Đổi sub-tab = lọc lại danh sách
// theo priceType VÀ gắn đúng priceType cho form tạo mới (KHÔNG có dropdown chọn tay, xem
// submitItPriceApproval()). Class active/inactive của 2 nút được cập nhật lại trong renderItPriceApprovals()
// (chạy mỗi lần render danh sách) để không cần gọi riêng ở đây.
let activeItPriceSubTab = 'RETAIL';
function setItPriceSubTab(subTab) {
  activeItPriceSubTab = subTab === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL';
  // Mục B: trường Mức Margin/Chiết Khấu chỉ hiện + bắt buộc khi đang ở sub-tab Bán Buôn.
  const tierWrap = document.getElementById('itPriceTierSelectWrap');
  if (tierWrap) tierWrap.classList.toggle('hidden', activeItPriceSubTab !== 'WHOLESALE');
  resetListPage('itPrice');
  renderItPriceApprovals();
}

// "File đã phê duyệt" — MIRROR ĐÚNG resolveApprovedFileId()/resolveApprovedFileUrl() ở
// lib/recordActions.js (server, dùng chung cho giới hạn tải file + route đánh dấu cột) — approvedFileId
// chỉ có ở đề xuất APPROVED SAU KHI tính năng chốt file này ra đời (lib/workflowEngine.js). Hồ sơ CŨ đã
// APPROVED từ trước không có field này — fallback: nếu chưa từng có yêu cầu bổ sung từ đội Hỗ Trợ IT
// (byRole:'it') thì coi file CUỐI CÙNG là file đã duyệt. Chưa APPROVED thì không có file nào "đã duyệt".
function resolveApprovedFileIdClient(p) {
  const files = p.files || [];
  if (p.approvedFileId) return p.approvedFileId;
  if (p.status === 'APPROVED' && !(p.infoRequests || []).some(r => r.byRole === 'it')) {
    return files.length ? files[files.length - 1].id : null;
  }
  return null;
}
function resolveApprovedFileUrlClient(p) {
  const approvedFileId = resolveApprovedFileIdClient(p);
  if (approvedFileId == null) return null;
  const f = (p.files || []).find(x => x.id === approvedFileId);
  return f ? f.fileUrl : null;
}

// Phạm vi Xem: admin/itManage (đội Hỗ Trợ IT) xem hết, người đề xuất xem đề xuất của mình, người
// duyệt xem hồ sơ nằm trong luồng duyệt của họ — không có quyền "Xem" riêng như carView/docView vì
// module này chưa cần phân biệt xem-rộng theo phòng ban.
function canViewItPriceApproval(user, p) {
  if (user.perms?.admin || user.perms?.itManage) return true;
  if (p.creator === user.username) return true;
  // Người có quyền itPriceEmergencyRejectApprove nhưng không phải người duyệt phòng ban vẫn cần xem
  // được hồ sơ đang có yêu cầu "Từ chối khẩn cấp" chờ họ xét (hoặc đã tự mình quyết định trước đó) —
  // khớp canViewItPriceApproval() ở lib/recordViewScope.js.
  if (user.perms?.itPriceEmergencyRejectApprove && (p.emergencyRejectStatus === 'PENDING' || p.emergencyRejectDecidedBy === user.username)) {
    return true;
  }
  return isApproverForDeptWorkflow(resolveItPriceWorkflowConfigForItemClient(p), user.username);
}

// Còn ít nhất 1 yêu cầu bổ sung CHƯA được người đề xuất phản hồi (chưa tải tệp bổ sung) — dùng chung
// item.infoRequests giữa nhánh REQUEST_INFO của người duyệt phòng ban (đang PENDING) và nhánh của đội
// Hỗ Trợ IT (sau khi đã APPROVED, trước khi áp giá), xem lib/workflowEngine.js + lib/recordActions.js.
// itPriceHasUnresolvedInfoRequest() da chuyen sang core.js (Ha tang: nap module theo cum, dot 7) -
// getMyPendingApprovals() (core-approvalhub.js, luon nap san) goi thang ham nay o MOI switchTab().

function itPriceStatusBadge(p) {
  if (p.status === 'REJECTED') return `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Từ chối</span>`;
  if (p.status === 'APPROVED') {
    if (itPriceHasUnresolvedInfoRequest(p)) return `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-xs">🟠 IT yêu cầu bổ sung</span>`;
    // autoApproved (server tự đặt, xem itPriceApprovals.extraValidate) — badge riêng để phân biệt với
    // duyệt tay bình thường, giữ minh bạch cho người xem danh sách biết hồ sơ này KHÔNG qua ai duyệt.
    if (p.autoApproved) return `<span class="px-2 py-0.5 bg-teal-100 text-teal-800 rounded font-bold text-xs">🤖 Tự động duyệt</span>`;
    return `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã phê duyệt</span>`;
  }
  if (itPriceHasUnresolvedInfoRequest(p)) return `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-xs">🟠 Chờ bổ sung</span>`;
  const wfConfig = resolveItPriceWorkflowConfigForItemClient(p) || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const wf = DB.workflows.find(w => w.id === wfConfig.workflowId) || { steps: [{ name: 'Duyệt' }] };
  const currentStepApprovers = wfConfig.approvers ? (wfConfig.approvers[p.currentStep] || []) : [];
  return `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded font-bold text-xs">⏳ Bước ${p.currentStep}/${wf.steps.length}${escapeHtml(getStepApprovalProgressText(currentStepApprovers, p.history, p.currentStep))}</span>`;
}

function itPriceAppliedBadge(p) {
  if (p.status !== 'APPROVED') return '<span class="text-gray-400 text-xs">—</span>';
  if (p.applied) {
    return `<span class="px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-xs">✅ Đã áp giá${p.appliedByName ? ` (${escapeHtml(p.appliedByName)})` : ''}</span>`;
  }
  if (p.applyClaimedBy) {
    return `<span class="px-2 py-0.5 bg-sky-100 text-sky-800 rounded font-bold text-xs">🖐️ Đang xử lý${p.applyClaimedByName ? ` (${escapeHtml(p.applyClaimedByName)})` : ''}</span>`;
  }
  return `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-xs">⏳ Chưa áp giá</span>`;
}

function renderItPriceApprovals() {
  const tbody = document.getElementById('itPriceTableBody');
  if (!tbody) return;

  // Đồng bộ giao diện sub-tab con (nút active/inactive, badge trên form tạo) mỗi lần render — gộp vào
  // đây thay vì tách riêng 1 hàm để không quên gọi ở bất kỳ chỗ nào khác kích hoạt render lại danh sách.
  const activeSubTabCls = 'px-3 py-1.5 rounded text-xs font-bold bg-sky-600 text-white';
  const inactiveSubTabCls = 'px-3 py-1.5 rounded text-xs font-bold bg-gray-200 text-gray-700';
  const btnRetail = document.getElementById('btnItPriceSubRetail');
  const btnWholesale = document.getElementById('btnItPriceSubWholesale');
  if (btnRetail) btnRetail.className = activeItPriceSubTab === 'RETAIL' ? activeSubTabCls : inactiveSubTabCls;
  if (btnWholesale) btnWholesale.className = activeItPriceSubTab === 'WHOLESALE' ? activeSubTabCls : inactiveSubTabCls;
  const formBadge = document.getElementById('itPriceFormSubTabBadge');
  if (formBadge) formBadge.innerText = activeItPriceSubTab === 'WHOLESALE' ? '🏪 Tạo cho: Bán Buôn' : '🏷️ Tạo cho: Bán Lẻ';

  const statusFilter = document.getElementById('filterStatusItPrice')?.value || '';
  const fromDate = document.getElementById('filterFromDateItPrice')?.value || '';
  const toDate = document.getElementById('filterToDateItPrice')?.value || '';
  const keyword = (document.getElementById('filterKeywordItPrice')?.value || '').trim();

  // Hồ sơ CŨ chưa có field priceType (tạo trước khi tính năng 2 sub-tab ra đời) -> fallback '|| RETAIL',
  // tức "mẫu hiện tại chuyển hết vào Bán Lẻ" — không cần script migrate dữ liệu (mục 1 kế hoạch).
  const scopedItPrice = DB.itPriceApprovals.filter(p => canViewItPriceApproval(currentUser, p) && (p.priceType || 'RETAIL') === activeItPriceSubTab);
  const itPriceDashCards = [
    { key: '', label: 'Tổng Đề Xuất', count: scopedItPrice.length, colorClass: 'border-l-blue-500' },
    { key: 'PENDING', label: 'Đang Chờ Duyệt', count: scopedItPrice.filter(p => p.status === 'PENDING').length, colorClass: 'border-l-yellow-500' },
    { key: 'APPROVED', label: 'Đã Phê Duyệt', count: scopedItPrice.filter(p => p.status === 'APPROVED').length, colorClass: 'border-l-green-500' },
    { key: 'REJECTED', label: 'Bị Từ Chối', count: scopedItPrice.filter(p => p.status === 'REJECTED').length, colorClass: 'border-l-red-500' }
  ];
  document.getElementById('itPriceDashboardCards').innerHTML = buildDashboardCardsHTML(itPriceDashCards, statusFilter, 'filterItPriceByCard');

  const visible = DB.itPriceApprovals.filter(p => {
    if (!canViewItPriceApproval(currentUser, p)) return false;
    if ((p.priceType || 'RETAIL') !== activeItPriceSubTab) return false;
    if (statusFilter && p.status !== statusFilter) return false;
    if (!isInDateRange(p.createdAt, fromDate, toDate)) return false;
    const latestFileName = (p.files && p.files.length) ? p.files[p.files.length - 1].fileName : '';
    if (!matchesKeywordFields([p.code, latestFileName, p.creatorName], keyword)) return false;
    return true;
  });

  document.getElementById('paginationContainer_itPrice').innerHTML = buildPaginationBoxHTML('itPrice', 'renderItPriceApprovals');
  const page = paginateList('itPrice', visible, 'renderItPriceApprovals', 'đề xuất');

  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-gray-500 italic">Không tìm thấy đề xuất phù hợp.</td></tr>`;
    return;
  }

  tbody.innerHTML = page.map(p => {
    const files = p.files || [];
    const latestFile = files[files.length - 1] || {};
    const extraFilesNote = files.length > 1 ? `<br><span class="text-xs text-gray-500">+${files.length - 1} tệp bổ sung</span>` : '';

    return `
      <tr class="hover:bg-gray-50 border-b">
        <td class="border p-2 font-mono font-bold text-sky-800">${escapeHtml(p.code)}</td>
        <td class="border p-2">${escapeHtml(p.dept)}<br><span class="text-xs text-gray-500">${escapeHtml(p.creatorName)}</span></td>
        <td class="border p-2">📎 ${escapeHtml(latestFile.fileName || '')}${extraFilesNote}</td>
        <td class="border p-2">${itPriceStatusBadge(p)}</td>
        <td class="border p-2">${itPriceAppliedBadge(p)}</td>
        <td class="border p-2 text-center">
          <button data-op="openItPriceModal" data-arg0="${p.id}" class="px-2.5 py-1 bg-sky-600 text-white rounded text-xs hover:opacity-90 font-bold">👁️ Chi tiết</button>
        </td>
      </tr>
    `;
  }).join('');
}

function approveItPrice(id) {
  withApprovalAuth(() => approveItPriceConfirmed(id));
}
async function approveItPriceConfirmed(id) {
  const p = DB.itPriceApprovals.find(x => x.id === id);
  if (!p) return;

  let result;
  try {
    result = await callWorkflowAction('itPriceApprovals', id, 'approve', {});
  } catch (e) {
    return alert('⛔ ' + e.message);
  }

  const updated = result.item;
  const transition = result.transition;
  const idx = DB.itPriceApprovals.findIndex(x => x.id === id);
  if (idx !== -1) DB.itPriceApprovals[idx] = updated;

  let msg = '✅ Đã ghi nhận phê duyệt của bạn!';
  if (transition.type === 'COMPLETED') {
    msg = '✅ Phê duyệt đề xuất giá thành công! Đội Hỗ Trợ IT sẽ áp giá vào hệ thống bán hàng rồi xác nhận hoàn thành.';
    notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_APPROVED', updated.code, [updated.creator],
      `[VPDT] Đề xuất duyệt giá ${updated.code} đã được phê duyệt`,
      `Đề xuất duyệt giá (${updated.code}) của bạn đã được phê duyệt hoàn tất.`);
  } else if (transition.type === 'ADVANCED') {
    msg = getStepAdvanceMessage(transition.stepApprovers);
    if (transition.nextApprovers.length) {
      notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_APPROVAL_NEEDED', updated.code, transition.nextApprovers,
        `[VPDT] Đề xuất duyệt giá ${updated.code} cần bạn phê duyệt`,
        `Đề xuất duyệt giá (${updated.code}) đang chờ bạn phê duyệt ở bước "${transition.nextStepName}".`);
    }
  } else if (transition.type === 'PARTIAL_APPROVE') {
    msg = '✅ Đã ghi nhận phê duyệt của bạn — đang chờ các đồng phê duyệt còn lại ở bước này.';
  }

  logSystemAction('IT_SUPPORT', 'APPROVE_IT_PRICE', `Phê duyệt đề xuất giá [${updated.code}] thành công.`, 'SUCCESS', updated.code);
  alert(msg);
  renderItPriceApprovals();
  if (currentItPriceModalId === id) renderItPriceModal();
  refreshApprovalSurfaces();
}

async function rejectItPrice(id) {
  const p = DB.itPriceApprovals.find(x => x.id === id);
  if (!p) return;

  const reason = prompt('Nhập lý do từ chối:');
  if (reason === null) return;

  let result;
  try {
    result = await callWorkflowAction('itPriceApprovals', id, 'reject', { comment: reason });
  } catch (e) {
    return alert('⛔ ' + e.message);
  }

  const updated = result.item;
  const idx = DB.itPriceApprovals.findIndex(x => x.id === id);
  if (idx !== -1) DB.itPriceApprovals[idx] = updated;

  logSystemAction('IT_SUPPORT', 'REJECT_IT_PRICE', `Từ chối đề xuất giá [${updated.code}]. Lý do: ${reason}`, 'SUCCESS', updated.code);
  notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_REJECTED', updated.code, [updated.creator],
    `[VPDT] Đề xuất duyệt giá ${updated.code} bị từ chối`,
    `Đề xuất duyệt giá (${updated.code}) của bạn đã bị từ chối. Lý do: ${reason}`);
  alert('❌ Đã từ chối đề xuất duyệt giá!');
  renderItPriceApprovals();
  if (currentItPriceModalId === id) renderItPriceModal();
  refreshApprovalSurfaces();
}

// "Tôi đang xử lý" — 1 người trong đội Hỗ Trợ IT nhận việc áp giá về mình, khoá lại để chỉ chính
// người đó (hoặc admin) mới xác nhận hoàn thành được sau này (xem claimPriceApply() ở server).
async function claimPriceApplyAction(id) {
  const p = DB.itPriceApprovals.find(x => x.id === id);
  if (!p) return;
  let result;
  try {
    result = await callRecordAction('itPriceApprovals', id, 'claim-apply', {});
  } catch (e) {
    return alert('⛔ ' + e.message);
  }
  const idx = DB.itPriceApprovals.findIndex(x => x.id === id);
  if (idx !== -1) DB.itPriceApprovals[idx] = result.item;
  logSystemAction('IT_SUPPORT', 'CLAIM_IT_PRICE_APPLY', `Nhận xử lý áp giá [${p.code}]`, 'SUCCESS', p.code);
  renderItPriceApprovals();
  if (currentItPriceModalId === id) renderItPriceModal();
}

// Huỷ nhận xử lý — trả về hàng đợi chung cho người khác trong đội nhận lại.
async function releasePriceApplyClaimAction(id) {
  const p = DB.itPriceApprovals.find(x => x.id === id);
  if (!p) return;
  if (!confirm('Huỷ nhận xử lý đề xuất này? Người khác trong đội Hỗ Trợ IT sẽ nhận lại được.')) return;
  let result;
  try {
    result = await callRecordAction('itPriceApprovals', id, 'release-apply-claim', {});
  } catch (e) {
    return alert('⛔ ' + e.message);
  }
  const idx = DB.itPriceApprovals.findIndex(x => x.id === id);
  if (idx !== -1) DB.itPriceApprovals[idx] = result.item;
  logSystemAction('IT_SUPPORT', 'RELEASE_IT_PRICE_APPLY_CLAIM', `Huỷ nhận xử lý áp giá [${p.code}]`, 'SUCCESS', p.code);
  renderItPriceApprovals();
  if (currentItPriceModalId === id) renderItPriceModal();
}

async function applyItPriceAction(id) {
  const p = DB.itPriceApprovals.find(x => x.id === id);
  if (!p) return;
  const latestFile = (p.files || [])[p.files.length - 1];
  if (!confirm(`Xác nhận đã áp bảng giá "${latestFile ? latestFile.fileName : ''}" vào hệ thống bán hàng?`)) return;

  let result;
  try {
    result = await callRecordAction('itPriceApprovals', id, 'apply', {});
  } catch (e) {
    return alert('⛔ ' + e.message);
  }

  const idx = DB.itPriceApprovals.findIndex(x => x.id === id);
  if (idx !== -1) DB.itPriceApprovals[idx] = result.item;
  logSystemAction('IT_SUPPORT', 'APPLY_IT_PRICE', `Xác nhận đã áp giá [${p.code}]`, 'SUCCESS', p.code);
  // Trước đây bước cuối cùng này (đội Hỗ Trợ IT xác nhận đã áp giá vào hệ thống bán hàng) KHÔNG gửi
  // thông báo gì cho người đề xuất ban đầu — họ chỉ biết đã áp giá xong nếu tự vào lại app kiểm tra.
  // Thêm thông báo email ở đúng bước "hoàn tất" này, khớp mọi bước khác của module (duyệt/từ chối/yêu
  // cầu bổ sung đều đã có thông báo tương ứng, xem approveItPriceConfirmed()/rejectItPrice() ở trên).
  notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_APPLIED', p.code, [result.item.creator],
    `[VPDT] Đề xuất duyệt giá ${p.code} đã áp giá xong`,
    `Đề xuất duyệt giá (${p.code}) của bạn đã được đội Hỗ Trợ IT áp giá vào hệ thống bán hàng, hoàn tất toàn bộ quy trình.`);
  alert('✅ Đã xác nhận áp giá thành công!');
  renderItPriceApprovals();
  if (currentItPriceModalId === id) renderItPriceModal();
}

function deleteItPriceAction(id) {
  const p = DB.itPriceApprovals.find(x => x.id === id);
  if (!p) return;
  deleteRecordAdminOnly('itPriceApprovals', id, `đề xuất duyệt giá ${p.code}`, () => {
    DB.itPriceApprovals = DB.itPriceApprovals.filter(x => x.id !== id);
    logSystemAction('IT_SUPPORT', 'DELETE_IT_PRICE', `Xóa đề xuất duyệt giá [${p.code}]`, 'SUCCESS', p.code);
    if (currentItPriceModalId === id) closeItPriceModal();
    renderItPriceApprovals();
  });
}

// So sánh nội dung tệp mới nhất với tệp liền trước — ghép dòng theo giá trị CỘT ĐẦU TIÊN của Mẫu Giá
// (columnLabels[0], vai trò định danh dòng tự nhiên nhất — thường là "Tên mặt hàng"/"Mã hàng" tuỳ mẫu,
// nhưng hệ thống không còn ép buộc ý nghĩa cột nào cả), dùng để hiển thị bảng "So Sánh Thay Đổi" trong
// modal chi tiết (bằng chứng tham chiếu khi có tệp bổ sung). Không khớp được theo cột đầu (trống/trùng)
// thì rơi về so khớp theo vị trí dòng.
// So khớp theo cột đầu tiên (idKey) giữa 2 lần nộp file — trả về từng dòng kèm "kind" (added/removed/
// changed/same) VÀ danh sách changedKeys (đúng những cột có giá trị khác nhau trong dòng "changed") để
// giao diện tô màu đúng từng ô đã đổi, không chỉ đánh dấu cả dòng. So sánh sau khi trim() để khoảng
// trắng thừa đầu/cuối không bị tính nhầm là "đã đổi" (lỗi dương tính giả hay gặp khi copy dữ liệu từ Excel).
// Trả về { rows, newDupKeys, oldDupKeys }: newDupKeys/oldDupKeys là các giá trị mã hàng (idKey) bị lặp lại
// từ 2 dòng trở lên trong CÙNG 1 tệp — trước đây bị Map ghép dòng "nuốt" âm thầm (chỉ giữ dòng cuối cùng),
// nay báo rõ ra để người dùng biết dữ liệu tệp gốc có vấn đề trước khi tin vào bảng so sánh.
function diffPriceFileItems(newItems, oldItems, columnLabels) {
  const idKey = (columnLabels && columnLabels[0]) ? columnLabels[0].key : null;
  const keyOf = (it, idx) => (idKey && it.values?.[idKey]) ? it.values[idKey] : `#${idx}`;
  const norm = (v) => (v || '').toString().trim();
  const findDupKeys = (items) => {
    if (!idKey) return [];
    const counts = new Map();
    (items || []).forEach(it => {
      const v = norm(it.values?.[idKey]);
      if (!v) return;
      counts.set(v, (counts.get(v) || 0) + 1);
    });
    return Array.from(counts.entries()).filter(([, n]) => n > 1).map(([v]) => v);
  };
  const oldMap = new Map((oldItems || []).map((it, idx) => [keyOf(it, idx), it]));
  const newMap = new Map((newItems || []).map((it, idx) => [keyOf(it, idx), it]));
  const keys = Array.from(new Set([...oldMap.keys(), ...newMap.keys()]));
  const rows = keys.map(key => {
    const oldIt = oldMap.get(key), newIt = newMap.get(key);
    if (oldIt && newIt) {
      const changedKeys = (columnLabels || []).map(c => c.key).filter(k => norm(oldIt.values?.[k]) !== norm(newIt.values?.[k]));
      return { values: newIt.values, oldValues: oldIt.values, kind: changedKeys.length ? 'changed' : 'same', changedKeys };
    }
    if (newIt) return { values: newIt.values, oldValues: null, kind: 'added', changedKeys: [] };
    return { values: oldIt.values, oldValues: null, kind: 'removed', changedKeys: [] };
  });
  // Xếp dòng có thay đổi (added/removed/changed) lên đầu để dễ rà soát, dòng "same" (không đổi) xuống
  // cuối — giữ nguyên thứ tự tương đối bên trong mỗi nhóm (sort ổn định).
  const KIND_ORDER = { added: 0, removed: 0, changed: 0, same: 1 };
  rows.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  return { rows, newDupKeys: findDupKeys(newItems), oldDupKeys: findDupKeys(oldItems) };
}

// Link tải Mẫu Giá đã áp dụng cho 1 đề xuất — dùng ở modal chi tiết (cho IT/người duyệt đối chiếu lại
// đúng khuôn cột đã dùng). masterListId có thể null (đề xuất cũ từ trước khi bắt buộc chọn mẫu, hoặc
// mẫu đã bị admin xoá sau đó) — khi đó không render gì.
function itPriceMasterListDownloadLinkHTML(masterListId) {
  if (!masterListId) return '';
  const list = (DB.itPriceMasterLists || []).find(m => m.id === masterListId);
  if (!list) return '';
  return ` <a href="${attachmentDownloadUrl(list.fileUrl, null, list.fileName)}" target="_blank" class="text-sky-600 hover:underline font-semibold">📥 Tải Mẫu</a>`;
}

// Xem trước 1 tệp trong danh sách "Tài liệu bổ sung liên quan" (p.extraFiles[idx]) — cùng Khung Xem
// Bảo Vệ với mọi tệp khác trong hệ thống (mirror viewSubmissionExtraFile()).
function viewItPriceExtraFile(itemId, idx) {
  const p = DB.itPriceApprovals.find(x => x.id === itemId);
  if (!p) return;
  const ef = (p.extraFiles || [])[idx];
  if (!ef || !ef.fileUrl) return;

  openFileProtectedView({
    title: `📎 ${ef.fileName || p.code} (${p.code})`,
    sub: `Phòng ban: ${p.dept} | Người đề xuất: ${p.creatorName}`,
    footerInfo: `Tài liệu bổ sung liên quan — Đề xuất duyệt giá: ${p.code}`,
    fileSrc: ef.fileUrl, fileType: ef.fileType, fileName: ef.fileName
  });
}

let currentItPriceModalId = null;

function openItPriceModal(id) {
  currentItPriceModalId = id;
  renderItPriceModal();
  document.getElementById('itPriceModal').classList.remove('hidden');
}
function closeItPriceModal() {
  document.getElementById('itPriceModal').classList.add('hidden');
  currentItPriceModalId = null;
  itPriceSupplementPendingFile = null;
}

function renderItPriceModal() {
  const p = DB.itPriceApprovals.find(x => x.id === currentItPriceModalId);
  if (!p) return closeItPriceModal();
  if (!canViewItPriceApproval(currentUser, p)) { alert('Bạn không có quyền xem đề xuất này.'); return closeItPriceModal(); }

  document.getElementById('itPriceModalTitle').innerText = `🏷️ ${p.code}`;
  document.getElementById('itPriceModalSub').innerText = `${p.dept} | ${p.creatorName} | ${p.createdAt}`;

  const historyRows = (p.history || []).filter(h => h.action === 'APPROVED' || h.action === 'REJECTED').map(h =>
    `<div><b>${h.action === 'APPROVED' ? 'Đã duyệt bởi' : 'Đã từ chối bởi'}:</b> ${escapeHtml(h.approver)} · ${escapeHtml(h.time)}${h.comment ? `<br><span class="text-xs text-gray-500">Lý do: ${escapeHtml(h.comment)}</span>` : ''}</div>`
  ).join('');

  document.getElementById('itPriceModalDetails').innerHTML = `
    <div><b>Trạng thái:</b> ${itPriceStatusBadge(p)}</div>
    <div><b>Áp giá:</b> ${itPriceAppliedBadge(p)}</div>
    ${p.priceType === 'WHOLESALE' ? `<div><b>Mức áp dụng:</b> ${escapeHtml(itPriceTierLabel(p.priceTier))}</div>` : ''}
    ${p.masterListName ? `<div><b>Mẫu Giá áp dụng:</b> ${escapeHtml(p.masterListName)}${itPriceMasterListDownloadLinkHTML(p.masterListId)}</div>` : ''}
    <div><b>Lý do điều chỉnh:</b> ${p.reason ? escapeHtml(p.reason) : '<span class="text-gray-400">—</span>'}</div>
    ${historyRows}
    ${p.applied ? `<div><b>Đã áp giá:</b> ${escapeHtml(p.appliedByName || '')} · ${escapeHtml(p.appliedAt || '')}</div>` : ''}
    ${!p.applied && p.applyClaimedBy ? `<div><b>Đang xử lý bởi:</b> ${escapeHtml(p.applyClaimedByName || p.applyClaimedBy)} · ${escapeHtml(p.applyClaimedAt || '')}</div>` : ''}
  `;

  const infoWrap = document.getElementById('itPriceModalInfoRequestsWrap');
  const requests = p.infoRequests || [];
  if (requests.length) {
    infoWrap.classList.remove('hidden');
    document.getElementById('itPriceModalInfoRequests').innerHTML = requests.map(r => `
      <div class="bg-white p-2 rounded border">
        <div class="font-bold">${r.byRole === 'it' ? '🛠️ IT' : '✅ Người duyệt'} ${escapeHtml(r.requestedByName)} yêu cầu bổ sung — ${escapeHtml(r.requestedAt)}</div>
        <div class="text-gray-600">${escapeHtml(r.reason)}</div>
        <div class="mt-1">${r.response
          ? `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">Đã bổ sung</span> <span class="text-gray-500">${escapeHtml(r.response)} · ${escapeHtml(r.respondedAt)}</span>`
          : `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-xs">Chưa bổ sung</span>`}</div>
      </div>
    `).join('');
  } else {
    infoWrap.classList.add('hidden');
  }

  const files = p.files || [];
  // Xem chú thích resolveApprovedFileIdClient()/resolveApprovedFileUrlClient() (mirror server) ở trên.
  const approvedFileId = resolveApprovedFileIdClient(p);
  document.getElementById('itPriceModalFiles').innerHTML = files.map((f, idx) => {
    const isLatest = idx === files.length - 1;
    const tagLatest = isLatest && files.length > 1 ? ' <span class="px-1.5 py-0.5 bg-sky-100 text-sky-800 rounded text-xs font-bold">Mới nhất</span>' : '';
    const tagOriginal = idx === 0 && files.length > 1 ? ' <span class="px-1.5 py-0.5 bg-gray-200 text-gray-700 rounded text-xs font-bold">Bản gốc</span>' : '';
    const isApprovedFile = f.id === approvedFileId;
    const tagApproved = isApprovedFile ? ' <span class="px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded text-xs font-bold">✅ File Đã Được Phê Duyệt</span>' : '';
    // columnLabels snapshot NGAY LÚC NỘP tệp này (xem submitPriceSupplementFile()/itPriceApprovals ở
    // server) — luôn hiển thị đúng tên cột đã dùng lúc đó, kể cả khi Mẫu Giá sau này bị sửa/xoá.
    const columnLabels = f.columnLabels && f.columnLabels.length ? f.columnLabels : [{ key: 'c0', label: 'Dữ liệu' }];
    // Giới hạn tải (mục 2 kế hoạch): CHỈ file khớp đúng resolveApprovedFileUrlClient(p) mới hiện nút
    // tải — server (lib/fileAuthz.js) chặn cứng phía sau nên đây chỉ là ẩn nút cho gọn giao diện, KHÔNG
    // phải lớp bảo vệ duy nhất. File khác vẫn xem được đầy đủ bảng dữ liệu bên dưới (KHÔNG ẩn nội dung).
    const downloadLinkHTML = isApprovedFile
      ? ` · <a href="${attachmentDownloadUrl(f.fileUrl, null, f.fileName)}" target="_blank" data-op="stopEventPropagation" data-arg-event="0" class="text-sky-600 hover:underline font-semibold">⬇️ Tải file gốc</a>`
      : ' · <span class="text-gray-400 italic">Chỉ file đã phê duyệt mới tải được</span>';
    // "Đánh dấu cột trước khi tải" (mục 4 kế hoạch) — CHỈ ở đúng file đã duyệt (route mới cũng tự chặn
    // lại y hệt điều kiện này ở server, xem routes/priceFile.js::POST /:id/download-marked).
    const markColsHTML = isApprovedFile ? `
        <div class="p-2 border-t bg-sky-50">
          <button type="button" data-op="toggleItPriceMarkColsBox" data-arg0="${f.id}" class="text-xs font-bold text-sky-700 hover:underline">📋 Đánh dấu cột trước khi tải</button>
          <div id="itPriceMarkColsBox_${f.id}" class="hidden mt-2 space-y-2">
            <p class="text-[11px] text-gray-500">Tick chọn cột cần đội Hỗ Trợ IT chú ý — file tải về vẫn giữ NGUYÊN ĐỦ mọi cột, chỉ tô nền xanh da trời cho các cột đã chọn.</p>
            <div class="flex flex-wrap gap-1.5">${columnLabels.map(col => `
              <label class="itPriceMarkColLabel inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] cursor-pointer bg-white">
                <input type="checkbox" class="itPriceMarkColCheckbox" data-op-change="onItPriceMarkColToggle" data-arg-event="0" value="${escapeHtml(col.key)}">
                <span>${escapeHtml(col.label)}</span>
              </label>`).join('')}
            </div>
            <button type="button" data-op="downloadItPriceMarkedFile" data-arg0="${p.id}" data-arg1="${f.id}" class="bg-sky-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-sky-700">⬇️ Tải file đã đánh dấu</button>
          </div>
        </div>` : '';
    return `
      <details class="border rounded bg-white" ${isLatest ? 'open' : ''}>
        <summary class="p-2 cursor-pointer font-semibold">📎 ${escapeHtml(f.fileName)}${tagLatest}${tagOriginal}${tagApproved}
          <span class="block text-xs font-normal text-gray-500 mt-0.5">Tải lên bởi ${escapeHtml(f.uploadedByName)} · ${escapeHtml(f.uploadedAt)} · ${(f.items || []).length} dòng${downloadLinkHTML}
          </span>
        </summary>
        <div class="p-2 border-t overflow-x-auto">
          <table class="w-full border-collapse text-xs">
            <thead><tr class="bg-gray-100 text-left text-gray-700">${columnLabels.map(col =>
              `<th class="border p-1">${escapeHtml(col.label)}</th>`
            ).join('')}</tr></thead>
            <tbody>${(f.items || []).map(it => `<tr>${columnLabels.map(col =>
              `<td class="border p-1">${itPriceCellHTML(it, col)}</td>`
            ).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>
        ${markColsHTML}
      </details>
    `;
  }).join('');

  // 📎 Tài liệu bổ sung liên quan (mục A) — mirror ĐÚNG khối render sub.extraFiles ở submissions
  // (~16272), luôn hiện nếu có ít nhất 1 tệp, không cần logic ẩn/hiện phức tạp. Không có khái niệm
  // canDL riêng cho module này (canViewItPriceApproval() đã gác cả modal ở đầu hàm) — Xem/Tải luôn hiện,
  // server (lib/fileAuthz.js) là lớp chặn thật sự phía sau.
  const extraFilesWrap = document.getElementById('itPriceModalExtraFilesWrap');
  const extraFiles = p.extraFiles || [];
  if (extraFiles.length > 0) {
    extraFilesWrap.classList.remove('hidden');
    document.getElementById('itPriceModalExtraFiles').innerHTML = extraFiles.map((ef, idx) => `
      <div class="flex items-center justify-between gap-2 ${idx > 0 ? 'border-t pt-1.5 mt-1.5' : ''}">
        <span class="truncate">📎 ${escapeHtml(ef.fileName || '')}</span>
        <div class="flex gap-1 shrink-0">
          <button type="button" data-op="viewItPriceExtraFile" data-arg0="${p.id}" data-arg1="${idx}" class="px-2 py-1 bg-blue-600 text-white rounded text-[11px] font-bold hover:bg-blue-700">👁️ Xem</button>
          <a href="${attachmentDownloadUrl(ef.fileUrl, null, ef.fileName || `${p.code}-${idx + 1}`)}" download="${escapeHtml(ef.fileName || `${p.code}-${idx + 1}`)}" class="px-2 py-1 bg-slate-600 text-white rounded text-[11px] font-bold hover:bg-slate-700">⬇️ Tải</a>
        </div>
      </div>
    `).join('');
  } else {
    extraFilesWrap.classList.add('hidden');
  }

  // Bảng "So Sánh Thay Đổi" — cột động theo ĐÚNG columnLabels của tệp mới nhất (không còn 3 cột cố định
  // Mã hàng/Tên mặt hàng/Thay đổi) + 1 cột "Trạng Thái" phụ ở cuối (Mới thêm/Đã bỏ/Đã đổi/Không đổi).
  const diffWrap = document.getElementById('itPriceModalDiffWrap');
  if (files.length > 1) {
    const latestColumnLabels = files[files.length - 1].columnLabels && files[files.length - 1].columnLabels.length
      ? files[files.length - 1].columnLabels : [{ key: 'c0', label: 'Dữ liệu' }];
    const { rows: diff, newDupKeys, oldDupKeys } = diffPriceFileItems(files[files.length - 1].items, files[files.length - 2].items, latestColumnLabels);
    diffWrap.classList.remove('hidden');
    // Cột "Trạng Thái" đặt ĐẦU TIÊN (trước mọi cột dữ liệu) — bảng nhiều cột dễ kéo ngang, để cuối thì
    // phải cuộn hết mới thấy dòng nào đổi, mất tác dụng cảnh báo ngay từ cái nhìn đầu tiên.
    document.getElementById('itPriceModalDiffHead').innerHTML = `<tr><th class="border p-1">Trạng Thái</th>${latestColumnLabels.map(col =>
      `<th class="border p-1">${escapeHtml(col.label)}</th>`
    ).join('')}</tr>`;
    const KIND_LABEL = {
      added: '<span class="text-emerald-800 font-bold">+ Mới thêm</span>',
      removed: '<span class="text-red-700 font-bold">− Đã bỏ</span>',
      changed: '<span class="text-amber-800 font-bold">≠ Đã đổi</span>',
      same: '<span class="text-gray-400">Không đổi</span>'
    };
    // Tô màu ĐẬM hơn bản trước (đổi từ -50/-100 sang -200 + viền màu) để không bị nhầm lẫn khi lướt nhanh:
    // cả dòng xanh đậm = dòng mới thêm, cả dòng đỏ đậm (kèm gạch ngang) = dòng đã bị xóa, riêng ô vàng đậm
    // = đúng ô có giá trị thay đổi trong dòng "đã đổi" (không tô cả dòng để người xem thấy ngay CHÍNH XÁC
    // cột nào đổi, nhất là khi bảng có nhiều cột).
    const ROW_CLASS = { added: 'bg-emerald-200', removed: 'bg-red-200 text-gray-600 line-through', changed: '', same: '' };
    document.getElementById('itPriceModalDiffBody').innerHTML = diff.map(d => {
      const rowClass = ROW_CLASS[d.kind] || '';
      return `<tr class="${rowClass}"><td class="border p-1 whitespace-nowrap">${KIND_LABEL[d.kind] || ''}</td>${latestColumnLabels.map(col => {
        const cellClass = (d.kind === 'changed' && d.changedKeys.includes(col.key)) ? ' bg-amber-200 border-amber-500 font-semibold text-amber-900' : '';
        return `<td class="border p-1${cellClass}">${escapeHtml(d.values?.[col.key] || '')}</td>`;
      }).join('')}</tr>`;
    }).join('');

    // Badge tổng quan: đếm nhanh số dòng theo từng loại thay đổi, hiển thị ngay đầu bảng so sánh để
    // người dùng không cần đếm thủ công qua cột "Trạng Thái".
    const cAdded = diff.filter(d => d.kind === 'added').length;
    const cRemoved = diff.filter(d => d.kind === 'removed').length;
    const cChanged = diff.filter(d => d.kind === 'changed').length;
    document.getElementById('itPriceModalDiffSummary').innerHTML = `
      <div class="flex flex-wrap gap-2 text-xs">
        <span class="px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 font-bold">+ ${cAdded} dòng mới</span>
        <span class="px-2 py-1 rounded-full bg-red-100 text-red-800 font-bold">− ${cRemoved} dòng xóa</span>
        <span class="px-2 py-1 rounded-full bg-amber-100 text-amber-800 font-bold">≠ ${cChanged} dòng đổi</span>
      </div>`;

    // Cảnh báo trùng mã hàng: idKey (cột đầu tiên) lặp lại nhiều dòng trong CÙNG 1 tệp khiến việc so khớp
    // theo mã hàng không còn tin cậy (Map chỉ giữ được 1 dòng cho mỗi mã) — hiện cảnh báo ngay trong phần
    // so sánh, không giấu ở nơi khác, để người duyệt biết cần kiểm tra lại tệp gốc.
    const dupWarnEl = document.getElementById('itPriceModalDiffDupWarning');
    if (newDupKeys.length || oldDupKeys.length) {
      const idLabel = escapeHtml(latestColumnLabels[0]?.label || 'mã hàng');
      const parts = [];
      if (newDupKeys.length) parts.push(`<div>⚠️ Tệp mới nhất có ${idLabel} bị lặp: <b>${newDupKeys.map(escapeHtml).join(', ')}</b></div>`);
      if (oldDupKeys.length) parts.push(`<div>⚠️ Tệp trước đó có ${idLabel} bị lặp: <b>${oldDupKeys.map(escapeHtml).join(', ')}</b></div>`);
      dupWarnEl.innerHTML = `<div class="font-bold mb-1">Cảnh báo trùng ${idLabel}</div>${parts.join('')}<div class="mt-1 text-red-600">Kết quả so sánh phía trên có thể không chính xác cho các mã bị trùng — chỉ so được 1 dòng đại diện cho mỗi mã.</div>`;
      dupWarnEl.classList.remove('hidden');
    } else {
      dupWarnEl.classList.add('hidden');
      dupWarnEl.innerHTML = '';
    }
  } else {
    diffWrap.classList.add('hidden');
  }

  renderItPriceModalControls(p);
}

// "Đánh dấu cột trước khi tải" (mục 4 kế hoạch) — mở/đóng box checkbox liệt kê columnLabels của file
// đã phê duyệt.
function toggleItPriceMarkColsBox(fileId) {
  const box = document.getElementById(`itPriceMarkColsBox_${fileId}`);
  if (box) box.classList.toggle('hidden');
}

// Tick chọn cột -> đổi nền nhãn sang xanh da trời nhạt (phản hồi trực quan lúc chọn, tô ĐÚNG màu sẽ
// hiện trong file tải về — xem MARK_COLUMN_FILL ở routes/priceFile.js).
function onItPriceMarkColToggle(event) {
  const cb = event.target;
  const label = cb.closest('.itPriceMarkColLabel');
  if (!label) return;
  label.classList.toggle('bg-sky-200', cb.checked);
  label.classList.toggle('bg-white', !cb.checked);
}

// Gọi POST /api/it-price/:id/download-marked (server tự kiểm lại quyền + xác định đúng file đã duyệt —
// KHÔNG tin riêng client, xem routes/priceFile.js) rồi tải blob trả về như file .xlsx — cùng khuôn
// downloadXlsxFromServer() (Quản trị > Xuất Excel) nhưng route khác (route đó không gắn với 1 hồ sơ cụ
// thể/không cần kiểm quyền theo hồ sơ).
async function downloadItPriceMarkedFile(itemId, fileId) {
  const box = document.getElementById(`itPriceMarkColsBox_${fileId}`);
  const columnKeys = box ? Array.from(box.querySelectorAll('.itPriceMarkColCheckbox:checked')).map(cb => cb.value) : [];
  if (!columnKeys.length) return alert('Vui lòng chọn ít nhất 1 cột cần đánh dấu.');
  try {
    const res = await fetch(`/api/it-price/${itemId}/download-marked`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ columnKeys })
    });
    if (res.status === 401) return handleSessionExpired();
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return alert(body.error || 'Không thể tải tệp đã đánh dấu');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const cd = res.headers.get('Content-Disposition') || '';
    const nameMatch = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    const link = document.createElement('a');
    link.href = url;
    link.download = nameMatch ? decodeURIComponent(nameMatch[1]) : 'bang-gia-danh-dau.xlsx';
    link.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('⛔ Không thể kết nối tới máy chủ: ' + e.message);
  }
}

function renderItPriceModalControls(p) {
  const wrap = document.getElementById('itPriceModalControls');
  const blocked = itPriceHasUnresolvedInfoRequest(p);
  const wfConfig = resolveItPriceWorkflowConfigForItemClient(p) || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const currentStepApprovers = wfConfig.approvers ? (wfConfig.approvers[p.currentStep] || []) : [];
  const canApprove = p.status === 'PENDING' && canApproveStep(currentUser, currentStepApprovers, p.history, p.currentStep);
  const emergencyPending = p.emergencyRejectStatus === 'PENDING';
  const canApply = p.status === 'APPROVED' && !p.applied && canManageItSupportClient(currentUser);
  let html = '';

  // Băng thông báo hiển thị cho MỌI người xem hồ sơ (người đề xuất, người duyệt, đội IT) khi đang có 1
  // yêu cầu "Từ chối khẩn cấp" chờ xử lý — đúng yêu cầu nghiệp vụ minh bạch, không chỉ riêng người có
  // quyền quyết định mới thấy.
  if (emergencyPending) {
    html += `<div class="bg-red-50 text-red-800 p-2 rounded border border-red-200">
      🚨 <b>${escapeHtml(p.emergencyRejectRequestedByName)}</b> đã gửi yêu cầu <b>Từ chối khẩn cấp</b> lúc ${escapeHtml(p.emergencyRejectRequestedAt)} — đang chờ người có quyền xét duyệt.
      <br><span class="text-xs">Lý do: "${escapeHtml(p.emergencyRejectReason)}"</span>
    </div>`;
  } else if (p.emergencyRejectStatus === 'DENIED') {
    html += `<div class="bg-gray-50 text-gray-600 p-2 rounded border border-gray-200 text-xs">
      Yêu cầu Từ chối khẩn cấp trước đó (bởi ${escapeHtml(p.emergencyRejectRequestedByName)}) đã bị ${escapeHtml(p.emergencyRejectDecidedByName)} từ chối${p.emergencyRejectDecisionComment ? `: "${escapeHtml(p.emergencyRejectDecisionComment)}"` : '.'}
    </div>`;
  }

  // Người có quyền itPriceEmergencyRejectApprove xét duyệt trực tiếp ngay tại đây.
  if (emergencyPending && canApproveItPriceEmergencyRejectClient(currentUser)) {
    html += `<div class="flex gap-2 flex-wrap mt-2">
      <button type="button" data-op="approveItPriceEmergencyRejectAction" data-arg0="${p.id}" class="bg-red-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-red-700">✅ Duyệt Huỷ Hồ Sơ</button>
      <button type="button" data-op="denyItPriceEmergencyRejectAction" data-arg0="${p.id}" class="bg-gray-500 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-600">❌ Từ Chối Yêu Cầu Này</button>
    </div>`;
  }

  // Nút "Từ chối khẩn" — CHỈ đúng người đã bấm Duyệt ở bước cuối cùng (hoặc admin), khi hồ sơ đã
  // APPROVED nhưng CHƯA áp giá thật, và chưa có yêu cầu nào khác đang chờ xử lý. `!p.applyClaimedBy`
  // ĐỘC LẬP với nhánh admin của isFinalStepApproverOfItPriceClient() (không đặt sau/trong nhánh đó) —
  // IT đã bấm "Tôi đang xử lý" (applyClaimedBy có giá trị) thì ẩn nút này cho MỌI người, KỂ CẢ ADMIN,
  // khớp chặn cứng phía server ở requestItPriceEmergencyReject() (lib/recordActions.js).
  if (p.status === 'APPROVED' && !p.applied && !emergencyPending && !p.applyClaimedBy && isFinalStepApproverOfItPriceClient(currentUser, p)) {
    html += `<div class="mt-2">
      <button type="button" data-op="requestItPriceEmergencyRejectAction" data-arg0="${p.id}" class="bg-red-700 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-red-800">🚨 Từ Chối Khẩn</button>
      <p class="text-[11px] text-gray-500 mt-1">Bạn đã duyệt hồ sơ này ở bước cuối cùng nhưng muốn dừng lại trước khi Hỗ Trợ IT áp giá thật — gửi yêu cầu cho người có quyền xét duyệt để huỷ hồ sơ.</p>
    </div>`;
  } else if (p.status === 'APPROVED' && !p.applied && !emergencyPending && p.applyClaimedBy && isFinalStepApproverOfItPriceClient(currentUser, p)) {
    html += `<div class="mt-2 text-[11px] text-gray-500 italic">🚨 Từ Chối Khẩn tạm khoá — IT (${escapeHtml(p.applyClaimedByName || p.applyClaimedBy)}) đang xử lý áp giá, chờ huỷ nhận việc hoặc hoàn tất trước.</div>`;
  }

  if (canApprove) {
    if (blocked) {
      html += `<div class="bg-amber-50 text-amber-800 p-2 rounded border border-amber-200">⏳ Đang chờ người đề xuất tải lên tệp bổ sung trước khi có thể duyệt.</div>`;
    } else {
      html += `<div class="flex gap-2 flex-wrap">
        <button type="button" data-op="approveItPrice" data-arg0="${p.id}" class="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-emerald-700">✅ Duyệt</button>
        <button type="button" data-op="rejectItPrice" data-arg0="${p.id}" class="bg-red-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-red-700">❌ Từ chối</button>
        <button type="button" data-op="requestItPriceInfoApprover" data-arg0="${p.id}" class="bg-amber-500 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-amber-600">✉️ Yêu Cầu Bổ Sung</button>
      </div>`;
    }
  }

  if (canApply) {
    if (emergencyPending) {
      html += `<div class="bg-red-50 text-red-800 p-2 rounded border border-red-200 mt-2">🚨 Đang chờ xét duyệt yêu cầu Từ chối khẩn cấp — tạm khoá nhận xử lý/xác nhận áp giá.</div>`;
    } else if (blocked) {
      html += `<div class="bg-amber-50 text-amber-800 p-2 rounded border border-amber-200 mt-2">⏳ Đang chờ người đề xuất tải lên tệp bổ sung trước khi có thể xác nhận áp giá.</div>`;
    } else {
      const isAdmin = !!currentUser.perms?.admin;
      const claimedByMe = p.applyClaimedBy === currentUser.username;
      const claimedByOther = !!p.applyClaimedBy && !claimedByMe;
      let claimHtml = '';
      // Bắt buộc bấm "Tôi đang xử lý" trước — chỉ đúng người đã nhận (hoặc admin) mới thấy nút xác
      // nhận hoàn thành, khớp yêu cầu nghiệp vụ: người khác không tự ý xác nhận hộ (xem
      // applyPriceApproval() ở lib/recordActions.js).
      if (!p.applyClaimedBy) {
        claimHtml += `<button type="button" data-op="claimPriceApplyAction" data-arg0="${p.id}" class="bg-sky-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-sky-700">🖐️ Tôi Đang Xử Lý</button>`;
        if (isAdmin) {
          claimHtml += `<button type="button" data-op="applyItPriceAction" data-arg0="${p.id}" class="bg-teal-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-teal-700">🏷️ Xác nhận đã áp giá</button>`;
        }
      } else if (claimedByMe || isAdmin) {
        claimHtml += `<button type="button" data-op="applyItPriceAction" data-arg0="${p.id}" class="bg-teal-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-teal-700">🏷️ Xác nhận đã áp giá</button>`;
        claimHtml += `<button type="button" data-op="releasePriceApplyClaimAction" data-arg0="${p.id}" class="bg-gray-400 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-500">↩️ Huỷ Nhận Xử Lý</button>`;
      }
      if (claimedByOther && !isAdmin) {
        claimHtml += `<span class="text-xs text-gray-500 self-center">🖐️ Đang được xử lý bởi <b>${escapeHtml(p.applyClaimedByName || p.applyClaimedBy)}</b> — bạn không xác nhận được đề xuất này.</span>`;
      }
      html += `<div class="flex gap-2 flex-wrap items-center mt-2">
        ${claimHtml}
        <button type="button" data-op="requestItPriceInfoIt" data-arg0="${p.id}" class="bg-amber-500 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-amber-600">✉️ Yêu Cầu Bổ Sung</button>
      </div>`;
    }
  }

  if (blocked && p.creator === currentUser.username) {
    const openReq = (p.infoRequests || []).find(r => !r.response);
    html += `
      <div class="bg-sky-50 p-3 rounded border border-sky-200 space-y-2 mt-2">
        <h4 class="font-bold text-sky-900">📤 Tải Lên Tệp Bổ Sung</h4>
        <p class="text-amber-700">${escapeHtml(openReq.requestedByName)} yêu cầu: "${escapeHtml(openReq.reason)}"</p>
        <input id="itPriceSupplementFileInput" type="file" accept=".xlsx,.xls" data-op-change="onItPriceSupplementFileChange" data-arg1="${p.masterListId || 'null'}" data-arg-event="0" class="w-full border p-1.5 rounded bg-white">
        <p id="itPriceSupplementFileStatus" class="text-gray-500"></p>
        <p class="text-gray-400">Tệp bổ sung sẽ được thêm vào bên cạnh tệp gốc, không thay thế — người duyệt/IT sẽ xem được cả bảng so sánh.</p>
        <button type="button" id="itPriceSupplementSendBtn" data-op="submitItPriceSupplementAction" data-arg0="${p.id}" class="bg-sky-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-sky-700 disabled:opacity-50" disabled>Gửi Tệp Bổ Sung</button>
      </div>`;
  }

  if (currentUser.perms?.admin) {
    html += `<div class="mt-2"><button type="button" data-op="deleteItPriceAction" data-arg0="${p.id}" class="bg-gray-500 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-600">🗑️ Xóa</button></div>`;
  }

  if (!html) html = '<p class="text-gray-400 italic">Không có thao tác nào khả dụng cho vai trò hiện tại.</p>';
  wrap.innerHTML = html;
}

// Yêu Cầu Bổ Sung từ người duyệt phòng ban (bước hiện tại, đang PENDING) — dùng chung hành động
// REQUEST_INFO của engine duyệt chung (lib/workflowEngine.js), ghi vào item.infoRequests.
async function requestItPriceInfoApprover(id) {
  const reason = prompt('Nhập nội dung cần bổ sung:');
  if (reason === null) return;
  if (!reason.trim()) return alert('Vui lòng nhập nội dung cần bổ sung.');

  let result;
  try {
    result = await callWorkflowAction('itPriceApprovals', id, 'request-info', { comment: reason.trim() });
  } catch (e) {
    return alert('⛔ ' + e.message);
  }
  const updated = result.item;
  const idx = DB.itPriceApprovals.findIndex(x => x.id === id);
  if (idx !== -1) DB.itPriceApprovals[idx] = updated;
  logSystemAction('IT_SUPPORT', 'REQUEST_INFO_IT_PRICE', `Yêu cầu bổ sung đề xuất giá [${updated.code}]`, 'SUCCESS', updated.code);
  notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_REQUEST_INFO', updated.code, [updated.creator],
    `[VPDT] Đề xuất duyệt giá ${updated.code} cần bổ sung`,
    `Đề xuất duyệt giá (${updated.code}) của bạn cần bổ sung: ${reason.trim()}`);
  alert('✅ Đã gửi yêu cầu bổ sung tới người đề xuất.');
  renderItPriceApprovals();
  if (currentItPriceModalId === id) renderItPriceModal();
}

// "Từ chối khẩn cấp" — chỉ đúng người đã duyệt bước cuối cùng (isFinalStepApproverOfItPriceClient()) mới
// thấy nút này (xem renderItPriceModalControls()), gửi yêu cầu cho người có quyền
// itPriceEmergencyRejectApprove xét duyệt, xem requestItPriceEmergencyReject() ở lib/recordActions.js.
async function requestItPriceEmergencyRejectAction(id) {
  const reason = prompt('Nhập lý do từ chối khẩn cấp (sẽ hiển thị cho người xét duyệt và trong lịch sử hồ sơ nếu được đồng ý):');
  if (reason === null) return;
  if (!reason.trim()) return alert('Vui lòng nhập lý do từ chối khẩn cấp.');

  let result;
  try {
    result = await callRecordAction('itPriceApprovals', id, 'request-emergency-reject', { reason: reason.trim() });
  } catch (e) {
    return alert('⛔ ' + e.message);
  }
  const updated = result.item;
  const idx = DB.itPriceApprovals.findIndex(x => x.id === id);
  if (idx !== -1) DB.itPriceApprovals[idx] = updated;
  logSystemAction('IT_SUPPORT', 'REQUEST_IT_PRICE_EMERGENCY_REJECT', `Gửi yêu cầu Từ chối khẩn cấp đề xuất giá [${updated.code}]`, 'SUCCESS', updated.code);
  const approverUsernames = getItPriceEmergencyRejectApproverUsernames();
  if (approverUsernames.length) {
    notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_IT_PRICE_EMERGENCY_REJECT_REQUEST', updated.code, approverUsernames,
      `[VPDT] Yêu cầu Từ chối khẩn cấp cho ${updated.code} cần xét duyệt`,
      `${currentUser.name} đã gửi yêu cầu Từ chối khẩn cấp cho đề xuất duyệt giá "${updated.productName}" (${updated.code}). Lý do: ${reason.trim()}`);
  }
  alert('✅ Đã gửi yêu cầu Từ chối khẩn cấp — chờ người có quyền xét duyệt.');
  refreshApprovalSurfaces();
  renderItPriceApprovals();
  if (currentItPriceModalId === id) renderItPriceModal();
}

async function approveItPriceEmergencyRejectAction(id) {
  let result;
  try {
    result = await callRecordAction('itPriceApprovals', id, 'approve-emergency-reject', {});
  } catch (e) {
    return alert('⛔ ' + e.message);
  }
  const updated = result.item;
  const idx = DB.itPriceApprovals.findIndex(x => x.id === id);
  if (idx !== -1) DB.itPriceApprovals[idx] = updated;
  logSystemAction('IT_SUPPORT', 'APPROVE_IT_PRICE_EMERGENCY_REJECT', `Duyệt Từ chối khẩn cấp đề xuất giá [${updated.code}] — hồ sơ chuyển Từ chối`, 'SUCCESS', updated.code);
  notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_IT_PRICE_EMERGENCY_REJECT_APPROVED', updated.code, [updated.creator],
    `[VPDT] Đề xuất duyệt giá ${updated.code} đã bị từ chối khẩn cấp`,
    `${currentUser.name} đã duyệt yêu cầu Từ chối khẩn cấp — đề xuất duyệt giá "${updated.productName}" (${updated.code}) của bạn đã chuyển sang Từ chối.`);
  alert('✅ Đã duyệt — hồ sơ chuyển sang Từ chối.');
  refreshApprovalSurfaces();
  renderItPriceApprovals();
  if (currentItPriceModalId === id) renderItPriceModal();
}

async function denyItPriceEmergencyRejectAction(id) {
  const comment = prompt('Nhập lý do từ chối yêu cầu Từ chối khẩn cấp này:');
  if (comment === null) return;
  if (!comment.trim()) return alert('Vui lòng nhập lý do.');

  let result;
  try {
    result = await callRecordAction('itPriceApprovals', id, 'deny-emergency-reject', { comment: comment.trim() });
  } catch (e) {
    return alert('⛔ ' + e.message);
  }
  const updated = result.item;
  const idx = DB.itPriceApprovals.findIndex(x => x.id === id);
  if (idx !== -1) DB.itPriceApprovals[idx] = updated;
  logSystemAction('IT_SUPPORT', 'DENY_IT_PRICE_EMERGENCY_REJECT', `Từ chối yêu cầu Từ chối khẩn cấp đề xuất giá [${updated.code}]`, 'SUCCESS', updated.code);
  if (updated.emergencyRejectRequestedBy) {
    notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_IT_PRICE_EMERGENCY_REJECT_DENIED', updated.code, [updated.emergencyRejectRequestedBy],
      `[VPDT] Yêu cầu Từ chối khẩn cấp cho ${updated.code} bị từ chối`,
      `${currentUser.name} đã từ chối yêu cầu Từ chối khẩn cấp của bạn cho đề xuất "${updated.productName}" (${updated.code}). Lý do: ${comment.trim()}`);
  }
  alert('❌ Đã từ chối yêu cầu Từ chối khẩn cấp.');
  refreshApprovalSurfaces();
  renderItPriceApprovals();
  if (currentItPriceModalId === id) renderItPriceModal();
}

// Yêu Cầu Bổ Sung từ đội Hỗ Trợ IT (sau khi đã APPROVED, trước khi áp giá) — route riêng (không đi qua
// engine duyệt chung vì hồ sơ không còn PENDING), xem requestPriceInfoFromIt() ở lib/recordActions.js.
async function requestItPriceInfoIt(id) {
  const reason = prompt('Nhập nội dung cần bổ sung:');
  if (reason === null) return;
  if (!reason.trim()) return alert('Vui lòng nhập nội dung cần bổ sung.');

  let result;
  try {
    result = await callRecordAction('itPriceApprovals', id, 'request-info', { reason: reason.trim() });
  } catch (e) {
    return alert('⛔ ' + e.message);
  }
  const updated = result.item;
  const idx = DB.itPriceApprovals.findIndex(x => x.id === id);
  if (idx !== -1) DB.itPriceApprovals[idx] = updated;
  logSystemAction('IT_SUPPORT', 'REQUEST_INFO_IT_PRICE', `Yêu cầu bổ sung đề xuất giá [${updated.code}]`, 'SUCCESS', updated.code);
  notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_REQUEST_INFO', updated.code, [updated.creator],
    `[VPDT] Đề xuất duyệt giá ${updated.code} cần bổ sung`,
    `Đề xuất duyệt giá (${updated.code}) của bạn cần bổ sung: ${reason.trim()}`);
  alert('✅ Đã gửi yêu cầu bổ sung tới người đề xuất.');
  renderItPriceApprovals();
  if (currentItPriceModalId === id) renderItPriceModal();
}

let itPriceSupplementPendingFile = null;

// masterListId (tuỳ chọn) — dùng lại ĐÚNG Mẫu Giá đã chọn lúc nộp lần đầu (p.masterListId, echo qua
// onclick lúc render) để tệp bổ sung được dò cột/gắn columnLabels NHẤT QUÁN với các lần nộp trước,
// không bắt người dùng chọn lại mẫu.
async function onItPriceSupplementFileChange(event, masterListId) {
  const file = event.target.files[0];
  itPriceSupplementPendingFile = null;
  const sendBtn = document.getElementById('itPriceSupplementSendBtn');
  if (sendBtn) sendBtn.disabled = true;
  const statusEl = document.getElementById('itPriceSupplementFileStatus');
  if (!file) { if (statusEl) statusEl.innerText = ''; return; }

  if (statusEl) statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  if (masterListId) formData.append('masterListId', masterListId);
  try {
    const res = await fetch('/api/it-price/parse-file', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    itPriceSupplementPendingFile = data;
    if (statusEl) statusEl.innerText = `✅ Đọc thành công ${data.items.length} dòng giá từ file "${data.fileName}".`;
    if (sendBtn) sendBtn.disabled = false;
  } catch (err) {
    if (statusEl) statusEl.innerText = `⛔ ${err.message}`;
    event.target.value = '';
  }
}

// Tệp bổ sung được THÊM VÀO cuối item.files, KHÔNG thay thế/xoá tệp trước đó — xem
// submitPriceSupplementFile() ở lib/recordActions.js (yêu cầu nghiệp vụ: giữ đủ mọi phiên bản làm
// bằng chứng tham chiếu).
async function submitItPriceSupplementAction(id) {
  if (!itPriceSupplementPendingFile) return alert('Vui lòng chọn tệp bảng giá bổ sung (.xlsx).');

  let result;
  try {
    result = await callRecordAction('itPriceApprovals', id, 'submit-supplement', {
      file: {
        fileUrl: itPriceSupplementPendingFile.fileUrl, fileName: itPriceSupplementPendingFile.fileName,
        items: itPriceSupplementPendingFile.items, columnLabels: itPriceSupplementPendingFile.columnLabels
      }
    });
  } catch (e) {
    return alert('⛔ ' + e.message);
  }
  const updated = result.item;
  const idx = DB.itPriceApprovals.findIndex(x => x.id === id);
  if (idx !== -1) DB.itPriceApprovals[idx] = updated;
  itPriceSupplementPendingFile = null;
  logSystemAction('IT_SUPPORT', 'SUBMIT_IT_PRICE_SUPPLEMENT', `Tải lên tệp bổ sung đề xuất giá [${updated.code}]`, 'SUCCESS', updated.code);
  alert('✅ Đã gửi tệp bổ sung — không thay thế tệp gốc, người duyệt/IT sẽ thấy cả bảng so sánh.');
  renderItPriceApprovals();
  if (currentItPriceModalId === id) renderItPriceModal();
}

// ----- 🎫 Hỗ Trợ Yêu Cầu -----
// Nhãn GỐC (defaults.js) — chỉ dùng làm fallback trong getItTicketCategoryLabel() khi key không (còn)
// có trong DB.itTicketCategories; hiển thị thật LUÔN đọc qua getItTicketCategoryLabel() để phản ánh
// đúng nhãn admin đã sửa ở màn Biểu Mẫu (CORE_FIELD_MANIFEST.IT_TICKET).
const IT_TICKET_CATEGORY_LABELS_DEFAULT = {
  HARDWARE: '🖥️ Phần cứng', SOFTWARE: '💿 Phần mềm', NETWORK: '🌐 Mạng / Internet',
  ACCOUNT: '🔑 Tài khoản / Đăng nhập', OTHER: '❓ Khác'
};
const IT_TICKET_STATUS_BADGES = {
  TODO: '<span class="px-2 py-0.5 bg-gray-100 text-gray-800 rounded font-bold text-xs">🕒 Chưa xử lý</span>',
  DOING: '<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-xs">🔧 Đang xử lý</span>',
  DONE: '<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Hoàn thành</span>',
  CANCELLED: '<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Đã hủy</span>'
};

async function submitItTicket(e) {
  e.preventDefault();
  const code = document.getElementById('itTicketCode').value.trim();
  if (DB.itSupportTickets.some(t => t.code === code)) {
    return alert('Mã yêu cầu đã tồn tại!');
  }
  const payload = {
    code,
    title: document.getElementById('itTicketTitle').value.trim(),
    category: document.getElementById('itTicketCategory').value,
    description: document.getElementById('itTicketDescription').value.trim(),
    createdAt: new Date().toLocaleString('vi-VN')
  };

  let newItem;
  try {
    const result = await callCreateAction('itSupportTickets', payload);
    newItem = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.itSupportTickets.unshift(newItem);
  logSystemAction('IT_SUPPORT', 'CREATE_IT_TICKET', `Tạo yêu cầu hỗ trợ IT [${code} - ${newItem.title}]`, 'SUCCESS', code);
  alert('✅ Đã gửi yêu cầu hỗ trợ IT thành công!');
  e.target.reset();
  document.getElementById('itTicketCode').value = generateItTicketCode();
  renderItTickets();
}

function onItTicketFilterChange() {
  resetListPage('itTicket');
  renderItTickets();
}

// Phạm vi Xem: hẹp hơn Phê Duyệt Giá vì ticket có thể chứa thông tin tài khoản/sự cố cá nhân — chỉ
// đội Hỗ Trợ IT (itManage/admin) và chính người tạo được xem, không mở rộng cho toàn phòng ban.
function canViewItTicket(user, t) {
  // Người được leo thang tới (t.approvalApprover) PHẢI thấy được ticket trong danh sách để mở ra phê
  // duyệt/từ chối — trước đây thiếu nhánh này nên chỉ admin/itManage/người tạo thấy được, người được
  // chỉ định phê duyệt (thường không có itManage) không có cách nào tìm lại đúng ticket đã escalate tới
  // mình qua renderItTickets(), dù modal chi tiết (đã có isDesignatedApprover riêng) cho họ thao tác
  // được NẾU mở đúng ticket bằng cách nào đó khác.
  return !!(user.perms?.admin || user.perms?.itManage || t.creator === user.username || t.approvalApprover === user.username);
}

function renderItTickets() {
  const tbody = document.getElementById('itTicketTableBody');
  if (!tbody) return;

  const statusFilter = document.getElementById('filterStatusItTicket')?.value || '';
  const categoryFilter = document.getElementById('filterCategoryItTicket')?.value || '';
  const keyword = (document.getElementById('filterKeywordItTicket')?.value || '').trim();

  const visible = DB.itSupportTickets.filter(t => {
    if (!canViewItTicket(currentUser, t)) return false;
    if (statusFilter && t.status !== statusFilter) return false;
    if (categoryFilter && t.category !== categoryFilter) return false;
    if (!matchesKeywordFields([t.code, t.title, t.creatorName], keyword)) return false;
    return true;
  });

  document.getElementById('paginationContainer_itTicket').innerHTML = buildPaginationBoxHTML('itTicket', 'renderItTickets');
  const page = paginateList('itTicket', visible, 'renderItTickets', 'yêu cầu');

  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-gray-500 italic">Không tìm thấy yêu cầu phù hợp.</td></tr>`;
    return;
  }

  tbody.innerHTML = page.map(t => `
    <tr class="hover:bg-gray-50 border-b">
      <td class="border p-2 font-mono font-bold text-emerald-800">${escapeHtml(t.code)}</td>
      <td class="border p-2">${escapeHtml(t.dept)}<br><span class="text-xs text-gray-500">${escapeHtml(t.creatorName)}</span></td>
      <td class="border p-2">${escapeHtml(t.title)}</td>
      <td class="border p-2 text-xs">${escapeHtml(getItTicketCategoryLabel(t.category))}</td>
      <td class="border p-2">${IT_TICKET_STATUS_BADGES[t.status] || escapeHtml(t.status)}</td>
      <td class="border p-2 text-xs">${t.assigneeName ? escapeHtml(t.assigneeName) : '<span class="text-gray-400 italic">Chưa nhận</span>'}</td>
      <td class="border p-2 text-center space-x-1">
        ${(() => {
          const primaryBtnHTML = `<button data-op="runItTicketAction" data-arg0="${t.id}" data-arg1="view" class="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs hover:opacity-90 font-bold">👁️ Xem / Xử lý</button>`;
          const secondaryOptions = [];
          if (currentUser.perms?.admin) secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });
          return buildActionCell(t.id, primaryBtnHTML, secondaryOptions, 'runItTicketAction');
        })()}
      </td>
    </tr>
  `).join('');
}

function runItTicketAction(id, action) {
  switch (action) {
    case 'view': openItTicketModal(id); break;
    case 'delete': deleteItTicketAction(id); break;
  }
}

function deleteItTicketAction(id) {
  const t = DB.itSupportTickets.find(x => x.id === id);
  if (!t) return;
  deleteRecordAdminOnly('itSupportTickets', id, `yêu cầu hỗ trợ ${t.code}`, () => {
    DB.itSupportTickets = DB.itSupportTickets.filter(x => x.id !== id);
    logSystemAction('IT_SUPPORT', 'DELETE_IT_TICKET', `Xóa yêu cầu hỗ trợ IT [${t.code}]`, 'SUCCESS', t.code);
    renderItTickets();
  });
}

let currentItTicketModalId = null;
let showItTicketEscalateForm = false;
// 2 hàm bọc cho onclick="showItTicketEscalateForm = true/false; renderItTicketModal();" cũ (gán biến +
// gọi hàm, không map được vào 1 lệnh gọi hàm đơn cho data-op) — xem CSP data-op ở bindCspDelegation().
function openItTicketEscalateForm() { showItTicketEscalateForm = true; renderItTicketModal(); }
function closeItTicketEscalateForm() { showItTicketEscalateForm = false; renderItTicketModal(); }

// Nhãn trạng thái leo thang phê duyệt (xem escalateItTicket() ở lib/recordActions.js) — tách biệt hoàn
// toàn khỏi IT_TICKET_STATUS_BADGES (t.status: TODO/DOING/DONE/CANCELLED).
const IT_TICKET_APPROVAL_BADGES = {
  PENDING: (t) => `<span class="px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-xs">⏳ Chờ ${escapeHtml(t.approvalApproverName)} duyệt</span>`,
  APPROVED: (t) => `<span class="px-2 py-0.5 bg-green-100 text-green-800 rounded font-bold text-xs">✅ ${escapeHtml(t.approvalApproverName)} đã duyệt</span>`,
  REJECTED: (t) => `<span class="px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-xs">❌ ${escapeHtml(t.approvalApproverName)} đã từ chối</span>`
};

function openItTicketModal(id) {
  currentItTicketModalId = id;
  showItTicketEscalateForm = false;
  renderItTicketModal();
  document.getElementById('itTicketModal').classList.remove('hidden');
}

function renderItTicketModal() {
  const t = DB.itSupportTickets.find(x => x.id === currentItTicketModalId);
  if (!t) return closeItTicketModal();

  document.getElementById('itTicketModalTitle').innerText = `🎫 ${t.code}: ${t.title}`;
  document.getElementById('itTicketModalSub').innerText = `${t.dept} | ${t.creatorName} | ${getItTicketCategoryLabel(t.category)}`;

  document.getElementById('itTicketModalDetails').innerHTML = `
    <div><b>Trạng thái:</b> ${IT_TICKET_STATUS_BADGES[t.status] || escapeHtml(t.status)}</div>
    <div><b>Người xử lý:</b> ${t.assigneeName ? escapeHtml(t.assigneeName) : 'Chưa có người nhận'}</div>
    ${t.approvalStatus ? `<div><b>Phê duyệt:</b> ${IT_TICKET_APPROVAL_BADGES[t.approvalStatus](t)}</div>` : ''}
    <div><b>Mô tả:</b><p class="bg-white p-2 rounded border mt-1">${escapeHtml(t.description)}</p></div>
    ${t.resolutionNote ? `<div><b>Ghi chú xử lý:</b><p class="bg-white p-2 rounded border mt-1">${escapeHtml(t.resolutionNote)}</p></div>` : ''}
  `;

  const canManage = canManageItSupportClient(currentUser);
  const isCreator = t.creator === currentUser.username;
  const isDesignatedApprover = t.approvalApprover === currentUser.username;
  const awaitingApproval = t.approvalStatus === 'PENDING';
  const blockedByRejection = t.approvalStatus === 'REJECTED';
  let controlsHTML = '';

  // Người có trách nhiệm được IT hỏi ý kiến — thấy thẻ Duyệt/Từ chối ngay khi mở, bất kể có phải đội
  // IT hay không (đúng yêu cầu: IT chủ động xin phép người có trách nhiệm trước khi tiếp tục xử lý).
  if (isDesignatedApprover && awaitingApproval) {
    controlsHTML += `
      <div class="bg-sky-50 p-3 rounded border border-sky-200 space-y-2 mb-2">
        <h4 class="font-bold text-sky-900">📨 Yêu Cầu Phê Duyệt Từ Đội Hỗ Trợ IT</h4>
        <p class="text-gray-600">${escapeHtml(t.approvalReason)}</p>
        <div class="flex gap-2">
          <button type="button" data-op="approveItTicketEscalationAction" class="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-emerald-700">✅ Duyệt</button>
          <button type="button" data-op="denyItTicketEscalationAction" class="bg-red-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-red-700">❌ Từ chối</button>
        </div>
      </div>`;
  }

  if (canManage && t.status === 'TODO') {
    controlsHTML += `<button type="button" data-op="claimItTicketAction" class="bg-sky-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-sky-700 mr-2">🎯 Nhận Xử Lý</button>`;
  }

  if (canManage && t.status === 'DOING') {
    // Đang chờ duyệt hoặc vừa bị từ chối — CHƯA cho phép đóng yêu cầu (Hoàn thành/Hủy qua nút dưới),
    // đúng yêu cầu "sau khi nhận phê duyệt thì IT mới tiếp tục xử lý" (server chặn lại ở
    // updateItTicketStatus(), đây chỉ là UI phản ánh đúng trạng thái).
    if (awaitingApproval) {
      controlsHTML += `<div class="bg-amber-50 text-amber-800 text-xs p-2 rounded border border-amber-200 mb-2">⏳ Đang chờ <b>${escapeHtml(t.approvalApproverName)}</b> phê duyệt trước khi tiếp tục xử lý.<br>Lý do đã gửi: "${escapeHtml(t.approvalReason)}"</div>`;
    } else {
      if (blockedByRejection) {
        controlsHTML += `<div class="bg-red-50 text-red-700 text-xs p-2 rounded border border-red-200 mb-2">❌ <b>${escapeHtml(t.approvalApproverName)}</b> đã từ chối yêu cầu phê duyệt${t.approvalComment ? `: "${escapeHtml(t.approvalComment)}"` : '.'}<br>Gửi lại yêu cầu tới người khác hoặc hủy yêu cầu hỗ trợ này.</div>`;
      }
      if (!showItTicketEscalateForm) {
        controlsHTML += `<button type="button" data-op="openItTicketEscalateForm" class="bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-300 mb-2">📨 ${blockedByRejection ? 'Gửi Lại' : 'Gửi'} Yêu Cầu Phê Duyệt</button>`;
      } else {
        const approverOptions = DB.users.filter(u => u.active !== false && u.username !== currentUser.username)
          .map(u => `<option value="${escapeHtml(u.username)}">${escapeHtml(u.name)} — ${escapeHtml(u.dept || '')}</option>`).join('');
        controlsHTML += `
          <div class="bg-sky-50 p-3 rounded border border-sky-200 space-y-2 mb-2">
            <h4 class="font-bold text-sky-900">📨 Gửi Yêu Cầu Phê Duyệt</h4>
            <select id="itTicketApproverSelect" class="w-full border p-1.5 rounded bg-white text-xs">${approverOptions}</select>
            <textarea id="itTicketApprovalReason" placeholder="Vì sao yêu cầu này cần phê duyệt trước khi xử lý?" class="w-full border p-1.5 rounded h-16 text-xs"></textarea>
            <div class="flex gap-2">
              <button type="button" data-op="escalateItTicketAction" class="bg-sky-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-sky-700">Gửi phê duyệt</button>
              <button type="button" data-op="closeItTicketEscalateForm" class="bg-gray-300 text-gray-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-400">Huỷ</button>
            </div>
          </div>`;
      }
      // Bị từ chối thì KHÔNG cho đóng yêu cầu qua đây nữa (phải gửi lại phê duyệt và được duyệt, hoặc
      // dùng nút "Hủy Yêu Cầu" riêng bên dưới).
      if (!blockedByRejection) {
        controlsHTML += `
          <div class="bg-sky-50 p-3 rounded border border-sky-200 space-y-2 mb-2">
            <h4 class="font-bold text-sky-900">🔧 Cập Nhật Xử Lý</h4>
            <select id="itTicketUpdateStatus" class="w-full border p-1.5 rounded bg-white text-xs">
              <option value="DONE">✅ Hoàn thành</option>
              <option value="CANCELLED">❌ Hủy yêu cầu</option>
            </select>
            <textarea id="itTicketUpdateNote" placeholder="Ghi chú xử lý (VD: đã thay ổ cứng, đã cấp lại mật khẩu...)" class="w-full border p-1.5 rounded h-16 text-xs">${escapeHtml(t.resolutionNote || '')}</textarea>
            <button type="button" data-op="updateItTicketStatusAction" class="bg-sky-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-sky-700">💾 Cập Nhật</button>
          </div>`;
      }
    }
  }
  if ((canManage || isCreator) && (t.status === 'TODO' || t.status === 'DOING')) {
    controlsHTML += `<button type="button" data-op="cancelItTicketAction" class="bg-red-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-red-700">❌ Hủy Yêu Cầu</button>`;
  }
  document.getElementById('itTicketModalControls').innerHTML = controlsHTML;

  const comments = t.comments || [];
  document.getElementById('itTicketModalComments').innerHTML = comments.length
    ? comments.map(c => `<div class="text-xs bg-white p-2 rounded border"><b>${escapeHtml(c.name)}</b> <span class="text-gray-400">(${escapeHtml(c.time)})</span><br>${escapeHtml(c.content)}</div>`).join('')
    : `<p class="text-xs text-gray-400 italic">Chưa có trao đổi nào.</p>`;
  document.getElementById('itTicketModalCommentBox').classList.toggle('hidden', !(canManage || isCreator || isDesignatedApprover));
}

function closeItTicketModal() {
  document.getElementById('itTicketModal').classList.add('hidden');
  currentItTicketModalId = null;
  showItTicketEscalateForm = false;
}

async function claimItTicketAction() {
  if (!currentItTicketModalId) return;
  let result;
  try {
    result = await callRecordAction('itSupportTickets', currentItTicketModalId, 'claim', {});
  } catch (e) {
    return alert('⛔ ' + e.message);
  }
  const idx = DB.itSupportTickets.findIndex(x => x.id === currentItTicketModalId);
  if (idx !== -1) DB.itSupportTickets[idx] = result.item;
  logSystemAction('IT_SUPPORT', 'CLAIM_IT_TICKET', `Nhận xử lý yêu cầu hỗ trợ IT [${result.item.code}]`, 'SUCCESS', result.item.code);
  renderItTickets();
  renderItTicketModal();
}

async function escalateItTicketAction() {
  if (!currentItTicketModalId) return;
  const approverUsername = document.getElementById('itTicketApproverSelect').value;
  const reason = document.getElementById('itTicketApprovalReason').value.trim();
  if (!reason) return alert('Vui lòng nhập lý do cần phê duyệt.');

  let result;
  try {
    result = await callRecordAction('itSupportTickets', currentItTicketModalId, 'escalate', { approverUsername, reason });
  } catch (e) {
    return alert('⛔ ' + e.message);
  }
  const updated = result.item;
  const idx = DB.itSupportTickets.findIndex(x => x.id === currentItTicketModalId);
  if (idx !== -1) DB.itSupportTickets[idx] = updated;
  logSystemAction('IT_SUPPORT', 'ESCALATE_IT_TICKET', `Gửi yêu cầu phê duyệt yêu cầu hỗ trợ IT [${updated.code}] tới ${updated.approvalApproverName}`, 'SUCCESS', updated.code);
  notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_TICKET_APPROVAL_NEEDED', updated.code, [updated.approvalApprover],
    `[VPDT] Yêu cầu hỗ trợ IT ${updated.code} cần bạn phê duyệt`,
    `Đội Hỗ Trợ IT đang xin ý kiến phê duyệt của bạn cho yêu cầu "${updated.title}" (${updated.code}). Lý do: ${reason}`);
  showItTicketEscalateForm = false;
  renderItTickets();
  renderItTicketModal();
  alert(`✅ Đã gửi yêu cầu phê duyệt tới ${updated.approvalApproverName}.`);
}

async function approveItTicketEscalationAction() {
  if (!currentItTicketModalId) return;
  let result;
  try {
    result = await callRecordAction('itSupportTickets', currentItTicketModalId, 'approve-escalation', {});
  } catch (e) {
    return alert('⛔ ' + e.message);
  }
  const updated = result.item;
  const idx = DB.itSupportTickets.findIndex(x => x.id === currentItTicketModalId);
  if (idx !== -1) DB.itSupportTickets[idx] = updated;
  logSystemAction('IT_SUPPORT', 'APPROVE_IT_TICKET_ESCALATION', `Duyệt yêu cầu phê duyệt cho yêu cầu hỗ trợ IT [${updated.code}]`, 'SUCCESS', updated.code);
  if (updated.assignee) {
    notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_TICKET_ESCALATION_APPROVED', updated.code, [updated.assignee],
      `[VPDT] Yêu cầu phê duyệt cho ${updated.code} đã được duyệt`,
      `${currentUser.name} đã duyệt yêu cầu phê duyệt cho "${updated.title}" (${updated.code}) — bạn có thể tiếp tục xử lý.`);
  }
  renderItTickets();
  renderItTicketModal();
  alert('✅ Đã duyệt yêu cầu phê duyệt.');
}

async function denyItTicketEscalationAction() {
  if (!currentItTicketModalId) return;
  const comment = prompt('Nhập lý do từ chối:');
  if (comment === null) return;
  if (!comment.trim()) return alert('Vui lòng nhập lý do từ chối.');

  let result;
  try {
    result = await callRecordAction('itSupportTickets', currentItTicketModalId, 'deny-escalation', { comment });
  } catch (e) {
    return alert('⛔ ' + e.message);
  }
  const updated = result.item;
  const idx = DB.itSupportTickets.findIndex(x => x.id === currentItTicketModalId);
  if (idx !== -1) DB.itSupportTickets[idx] = updated;
  logSystemAction('IT_SUPPORT', 'DENY_IT_TICKET_ESCALATION', `Từ chối yêu cầu phê duyệt cho yêu cầu hỗ trợ IT [${updated.code}]`, 'SUCCESS', updated.code);
  if (updated.assignee) {
    notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_TICKET_ESCALATION_DENIED', updated.code, [updated.assignee],
      `[VPDT] Yêu cầu phê duyệt cho ${updated.code} bị từ chối`,
      `${currentUser.name} đã từ chối yêu cầu phê duyệt cho "${updated.title}" (${updated.code}). Lý do: ${comment}`);
  }
  renderItTickets();
  renderItTicketModal();
  alert('❌ Đã từ chối yêu cầu phê duyệt.');
}

async function updateItTicketStatusAction() {
  if (!currentItTicketModalId) return;
  const status = document.getElementById('itTicketUpdateStatus').value;
  const resolutionNote = document.getElementById('itTicketUpdateNote').value.trim();

  let result;
  try {
    result = await callRecordAction('itSupportTickets', currentItTicketModalId, 'update-status', { status, resolutionNote });
  } catch (e) {
    return alert('⛔ ' + e.message);
  }

  const updated = result.item;
  const idx = DB.itSupportTickets.findIndex(x => x.id === currentItTicketModalId);
  if (idx !== -1) DB.itSupportTickets[idx] = updated;
  logSystemAction('IT_SUPPORT', 'UPDATE_IT_TICKET_STATUS', `Cập nhật trạng thái yêu cầu hỗ trợ IT [${updated.code}] -> ${status}`, 'SUCCESS', updated.code);
  if (status === 'DONE') {
    notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_TICKET_DONE', updated.code, [updated.creator],
      `[VPDT] Yêu cầu hỗ trợ IT ${updated.code} đã hoàn thành`,
      `Yêu cầu hỗ trợ IT "${updated.title}" (${updated.code}) của bạn đã được xử lý xong.${resolutionNote ? ` Ghi chú: ${resolutionNote}` : ''}`);
  }
  alert('✅ Đã cập nhật trạng thái yêu cầu!');
  renderItTickets();
  closeItTicketModal();
}

async function cancelItTicketAction() {
  if (!currentItTicketModalId) return;
  if (!confirm('Xác nhận hủy yêu cầu hỗ trợ này?')) return;

  let result;
  try {
    result = await callRecordAction('itSupportTickets', currentItTicketModalId, 'cancel', {});
  } catch (e) {
    return alert('⛔ ' + e.message);
  }

  const idx = DB.itSupportTickets.findIndex(x => x.id === currentItTicketModalId);
  if (idx !== -1) DB.itSupportTickets[idx] = result.item;
  logSystemAction('IT_SUPPORT', 'CANCEL_IT_TICKET', `Hủy yêu cầu hỗ trợ IT [${result.item.code}]`, 'SUCCESS', result.item.code);
  renderItTickets();
  closeItTicketModal();
}

async function submitItTicketComment() {
  if (!currentItTicketModalId) return;
  const input = document.getElementById('itTicketCommentInput');
  const content = input.value.trim();
  if (!content) return;

  let result;
  try {
    result = await callRecordAction('itSupportTickets', currentItTicketModalId, 'comment', { content });
  } catch (e) {
    return alert('⛔ ' + e.message);
  }

  const idx = DB.itSupportTickets.findIndex(x => x.id === currentItTicketModalId);
  if (idx !== -1) DB.itSupportTickets[idx] = result.item;
  input.value = '';
  openItTicketModal(currentItTicketModalId);
}

