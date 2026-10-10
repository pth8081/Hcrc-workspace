// module-hopdonglaodong.js — Hợp Đồng Lao Động (Đợt 2/4 module Nhân Sự, Phần D tài liệu thiết kế gốc).
// HR-only (không có tầng tự xem của nhân viên ở đợt này — xem canAccessHrContractModule() ở core.js).
// Đi qua đường CHUNG (POST /api/create/laborContracts, POST /api/records/laborContracts/:id/<action>)
// — KHÁC module-hrprofile.js (dedicated router riêng /api/hr-profile/*) vì laborContracts KHÔNG cần
// strip field theo vai trò người xem (chỉ 1 vai trò duy nhất được vào màn: hrContractManage/admin).
const HRC_CONTRACT_TYPE_LABELS = { PROBATION: 'Thử việc', FIXED_TERM: 'Xác định thời hạn', INDEFINITE: 'Vô thời hạn' };
const HRC_STATUS_LABELS = {
  DRAFT: '📝 Nháp', ACTIVE: '✅ Đang hiệu lực', EXPIRED: '⌛ Hết hạn',
  TERMINATED: '⛔ Đã chấm dứt', SUPERSEDED: '🔄 Đã thay thế'
};

// Cảnh báo hợp đồng sắp/đã hết hiệu lực (9/2026, theo yêu cầu người dùng) — chỉ áp dụng cho hợp đồng
// ĐANG ACTIVE có ngày hết hạn (Vô thời hạn/DRAFT/TERMINATED/SUPERSEDED không cần cảnh báo). Ngưỡng:
// ≤7 ngày hoặc đã qua hạn = ĐỎ (khẩn cấp), ≤30 ngày = VÀNG (sắp tới), còn lại = không cảnh báo.
function hrcDaysUntilExpiry(endDate) {
  if (!endDate) return null;
  const end = new Date(endDate + 'T00:00:00');
  if (isNaN(end.getTime())) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((end - today) / 86400000);
}
function hrcExpiryBadgeHtml(c) {
  if (c.status !== 'ACTIVE' || !c.endDate) return '';
  const days = hrcDaysUntilExpiry(c.endDate);
  if (days == null) return '';
  if (days < 0) return `<span class="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">⛔ Đã hết hạn ${Math.abs(days)} ngày</span>`;
  if (days <= 7) return `<span class="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">🔴 Còn ${days} ngày</span>`;
  if (days <= 30) return `<span class="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">⚠️ Còn ${days} ngày</span>`;
  return '';
}

// Amendment "Giá trị cũ/mới" (9/2026, theo phản hồi người dùng: đợt trước tự đoán bằng cách "Loại thay
// đổi" có chứa chữ 'lương' hay không — KHÔNG đáng tin, vì người dùng có thể gõ Giá trị cũ/mới TRƯỚC khi
// gõ Loại thay đổi (giá trị gõ trước không được tự định dạng lại), hoặc Loại thay đổi không chứa đúng
// chữ "lương" dù vẫn là số tiền (VD "Điều chỉnh thu nhập"). Thay bằng 1 checkbox tường minh
// #hrcNewAmendmentIsMoney (mặc định BẬT — đa số phụ lục liên quan lương) — người dùng tự TẮT khi thật
// sự cần gõ chữ tự do (VD đổi chức danh/phòng ban), không đoán mò theo nội dung field khác nữa.
function toggleHrcAmendmentMoneyMode() {
  const isMoney = !!document.getElementById('hrcNewAmendmentIsMoney')?.checked;
  const oldEl = document.getElementById('hrcNewAmendmentOld');
  const newEl = document.getElementById('hrcNewAmendmentNew');
  if (!oldEl || !newEl) return;
  for (const el of [oldEl, newEl]) {
    el.classList.toggle('money-input', isMoney);
    if (isMoney) el.value = formatMoneyDisplay(el.value);
  }
  oldEl.placeholder = isMoney ? 'Giá trị cũ (đ)' : 'Giá trị cũ';
  newEl.placeholder = isMoney ? 'Giá trị mới (đ)' : 'Giá trị mới';
}

function renderHrContractModule() {
  renderHrContractTable();
}

function getHrContractList() {
  return (DB.laborContracts || []).slice().sort((a, b) => (b.id || 0) - (a.id || 0));
}

function renderHrContractTable() {
  const kwInputEl = document.getElementById('hrcFilterEmployeeCode');
  const kw = (kwInputEl?.value || '').trim();
  const statusFilter = document.getElementById('hrcFilterStatus')?.value || '';
  let list = getHrContractList();
  // Mở rộng tìm kiếm (10/2026) — trước đây chỉ lọc employeeCode theo includes() thủ công, giờ thêm Mã
  // HĐLĐ + Họ Tên (tra qua hrcEmployeeDirectoryCache, nạp sẵn ở đây nếu chưa có — laborContracts không
  // tự lưu tên, xem chú thích đầy đủ ở exportHrContractListToExcel() cùng file).
  if (kw) {
    if (!hrcEmployeeDirectoryCache.length) { loadHrcEmployeeDirectory().then(() => renderHrContractTable()); }
    const nameByCode = {};
    hrcEmployeeDirectoryCache.forEach(p => { nameByCode[p.employeeCode] = p.fullName; });
    list = list.filter(c => matchesAnyKeyword([c.employeeCode, c.code, nameByCode[c.employeeCode], ...customDataSearchValues(c.customData)], kwInputEl?._multiKeywords, kw));
  }
  if (statusFilter) list = list.filter(c => c.status === statusFilter);

  const tbody = document.getElementById('hrcTableBody');
  const empty = document.getElementById('hrcTableEmpty');
  if (!tbody) return;
  empty.classList.toggle('hidden', list.length > 0);
  tbody.innerHTML = list.map(c => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-2 font-mono">${escapeHtml(c.code || '')}</td>
      <td class="p-2">${escapeHtml(c.employeeCode || '')}</td>
      <td class="p-2">${escapeHtml(HRC_CONTRACT_TYPE_LABELS[c.contractType] || c.contractType)}</td>
      <td class="p-2">${escapeHtml(HRC_STATUS_LABELS[c.status] || c.status)}</td>
      <td class="p-2">${escapeHtml(c.startDate || '')}</td>
      <td class="p-2 whitespace-nowrap">${escapeHtml(c.endDate || '(Vô thời hạn)')}${hrcExpiryBadgeHtml(c)}</td>
      <td class="p-2">
        <button type="button" data-op="openHrContractDetailModal" data-arg0="${c.id}" class="bg-teal-600 text-white px-2 py-1 rounded text-[11px] hover:bg-teal-700">Chi Tiết</button>
      </td>
    </tr>
  `).join('');
}

function onHrContractFilterChange() { renderHrContractTable(); }

// Xuất Excel (10/2026) — xuất ĐÚNG danh sách đang lọc trên màn (cùng quy ước "Xuất Excel" ở các màn
// khác: xuất đúng phần đang xem, không phải toàn bộ collection chưa lọc). Cần tra Họ Tên qua
// /api/hr-profile/employee-directory (laborContracts không tự lưu tên) — tái dùng cache đã có nếu đã
// từng mở modal "Tạo Hợp Đồng Mới", nạp mới nếu chưa có.
async function exportHrContractExcel() {
  const empCodeFilter = (document.getElementById('hrcFilterEmployeeCode')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('hrcFilterStatus')?.value || '';
  let list = getHrContractList();
  if (empCodeFilter) list = list.filter(c => (c.employeeCode || '').toLowerCase().includes(empCodeFilter));
  if (statusFilter) list = list.filter(c => c.status === statusFilter);
  if (!list.length) return alert('Chưa có hợp đồng nào để xuất (theo bộ lọc đang chọn).');

  if (!hrcEmployeeDirectoryCache.length) await loadHrcEmployeeDirectory();
  const nameByCode = {};
  hrcEmployeeDirectoryCache.forEach(p => { nameByCode[p.employeeCode] = p.fullName; });

  const columns = [
    { header: 'Mã Nhân Viên', key: 'employeeCode', width: 16 }, { header: 'Họ Và Tên', key: 'fullName', width: 24 },
    { header: 'Loại HĐLĐ', key: 'contractTypeLabel', width: 20 }, { header: 'Ngày Hiệu Lực', key: 'startDate', width: 16 },
    { header: 'Ngày Hết Hạn', key: 'endDate', width: 16 }, { header: 'Lương Cơ Bản', key: 'baseSalary', width: 16 },
    { header: 'Phụ Cấp Trách Nhiệm', key: 'responsibilityAllowance', width: 16 }, { header: 'Phụ Cấp Kiêm Nhiệm', key: 'concurrentAllowance', width: 16 },
    { header: 'Phụ Cấp Độc Hại Nặng Nhọc', key: 'hazardAllowance', width: 16 }, { header: 'Phụ Cấp Ăn Trưa', key: 'lunchAllowance', width: 16 },
    { header: 'Hỗ Trợ Đi Lại', key: 'transportAllowance', width: 16 }, { header: 'Hỗ Trợ Điện Thoại', key: 'phoneAllowance', width: 16 },
    { header: 'Phụ Cấp/Hỗ Trợ Khác', key: 'otherAllowance', width: 16 }, { header: 'Phòng Ban', key: 'dept', width: 20 },
    { header: 'Mã Hợp Đồng (CHỈ XEM)', key: 'code', width: 20 }, { header: 'Trạng Thái (CHỈ XEM)', key: 'statusLabel', width: 16 },
    { header: 'Lần Gia Hạn (CHỈ XEM)', key: 'renewalIndex', width: 12 }, { header: 'Ngày Chấm Dứt (CHỈ XEM)', key: 'terminationDate', width: 16 },
    { header: 'Lý Do Chấm Dứt (CHỈ XEM)', key: 'terminationReason', width: 26 }
  ];
  const rows = list.map(c => ({
    employeeCode: c.employeeCode || '', fullName: nameByCode[c.employeeCode] || '',
    contractTypeLabel: HRC_CONTRACT_TYPE_LABELS[c.contractType] || c.contractType || '',
    startDate: c.startDate || '', endDate: c.endDate || '(Vô thời hạn)', baseSalary: c.baseSalary,
    responsibilityAllowance: c.responsibilityAllowance, concurrentAllowance: c.concurrentAllowance,
    hazardAllowance: c.hazardAllowance, lunchAllowance: c.lunchAllowance,
    transportAllowance: c.transportAllowance, phoneAllowance: c.phoneAllowance, otherAllowance: c.otherAllowance,
    dept: c.dept || '', code: c.code || '', statusLabel: HRC_STATUS_LABELS[c.status] || c.status || '',
    renewalIndex: c.renewalIndex, terminationDate: c.terminationDate || '', terminationReason: c.terminationReason || ''
  }));
  downloadXlsxFromServer('Hop_Dong_Lao_Dong.xlsx', 'Hợp Đồng Lao Động', columns, rows);
}

// Thay đúng 1 phần tử trong DB.laborContracts bằng bản mới nhất server trả về (mirror
// hrpApplyProcessUpdate() ở module-hrlifecycle.js) — dùng chung cho MỌI action trả về {item}.
function hrcApplyUpdate(item) {
  DB.laborContracts = DB.laborContracts || [];
  const idx = DB.laborContracts.findIndex(c => c.id === item.id);
  if (idx >= 0) DB.laborContracts[idx] = item; else DB.laborContracts.unshift(item);
  renderHrContractTable();
}

// ===== Tạo hợp đồng TAY (ngoại lệ — đa số bản ghi hệ thống tự tạo qua hook Onboarding) =====
//
// Mã Nhân Viên: MẶC ĐỊNH bắt buộc chọn từ Hồ Sơ Nhân Sự (đúng khuôn resolveUniformEmployeeInput() ở
// module-dongphuc.js — ô tìm-chọn sdd*, khớp nhãn "Tên (Mã NV)" bằng regex, KHÔNG gõ tự do) để tránh gõ
// sai mã — người dùng bấm tick "Không lấy từ hồ sơ" (#hrcNewUseExternalCode) mới chuyển sang ô nhập tay
// tự do (nhân viên cũ/cộng tác viên chưa có hồ sơ trong hệ thống). Server (createValidation.js
// laborContracts.extraValidate) validate lại y hệt — client chỉ chặn sớm cho gọn UX.
//
// Dữ liệu picker lấy qua route riêng GET /api/hr-profile/employee-directory (module-hrprofile.js KHÔNG
// đảm bảo đã nạp cùng cụm module với module này — xem MODULE_LOAD_GROUPS ở core.js, "hopdonglaodong"
// không phụ thuộc "hrprofile" — nên gọi fetch() thẳng tại đây, không dùng lại hrProfileApiCall()).
let hrcEmployeeDirectoryCache = [];

async function loadHrcEmployeeDirectory() {
  try {
    const res = await fetch('/api/hr-profile/employee-directory');
    if (res.status === 401) { handleSessionExpired(); return; }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Không tải được danh sách Hồ Sơ Nhân Sự');
    hrcEmployeeDirectoryCache = json.directory || [];
    sddSetOptions('hrcEmployeeDirectoryDatalist', hrcEmployeeDirectoryCache.map(p => `${p.fullName || '(chưa rõ tên)'} (${p.employeeCode})`));
  } catch (err) {
    hrcEmployeeDirectoryCache = [];
    console.error('loadHrcEmployeeDirectory:', err.message);
  }
}

// Khớp text đang gõ (định dạng "Tên (Mã NV)") với đúng 1 hồ sơ trong danh sách vừa nạp -> ghi Mã NV vào
// input ẩn #hrcNewEmployeeCodeResolved; không khớp (gõ tự do/chưa chọn xong) thì để trống, submit sẽ
// báo lỗi "chưa chọn nhân viên".
function resolveHrcEmployeeCodeInput(rawValue) {
  const m = (rawValue || '').match(/\(([^()]+)\)\s*$/);
  const code = m ? m[1].trim() : '';
  const found = hrcEmployeeDirectoryCache.some(p => p.employeeCode === code);
  document.getElementById('hrcNewEmployeeCodeResolved').value = found ? code : '';
}

// Tick "Không lấy từ hồ sơ" -> ẩn ô tìm-chọn, hiện ô nhập tay tự do (và ngược lại) — xoá dữ liệu ở nhánh
// vừa ẩn để tránh sót giá trị cũ từ lần chọn trước lọt vào submit.
function onHrcUseExternalCodeChange(checkboxEl) {
  const external = !!checkboxEl.checked;
  document.getElementById('hrcNewEmployeePickerWrap').classList.toggle('hidden', external);
  document.getElementById('hrcNewEmployeeCodeManual').classList.toggle('hidden', !external);
  if (external) {
    document.getElementById('hrcNewEmployeePickerInput').value = '';
    document.getElementById('hrcNewEmployeeCodeResolved').value = '';
  } else {
    document.getElementById('hrcNewEmployeeCodeManual').value = '';
  }
}

function openHrContractCreateModal() {
  document.getElementById('hrContractCreateForm').reset();
  document.getElementById('hrcNewEmployeePickerWrap').classList.remove('hidden');
  document.getElementById('hrcNewEmployeeCodeManual').classList.add('hidden');
  renderDynamicInputsForModule('LABOR_CONTRACT', 'dynamicFieldsContainer_LABOR_CONTRACT');
  document.getElementById('hrContractCreateModal').classList.remove('hidden');
  loadHrcEmployeeDirectory();
}
function closeHrContractCreateModal() {
  document.getElementById('hrContractCreateModal').classList.add('hidden');
}

async function submitHrContractCreate(e) {
  e.preventDefault();
  const useExternalCode = !!document.getElementById('hrcNewUseExternalCode').checked;
  const employeeCode = (useExternalCode
    ? document.getElementById('hrcNewEmployeeCodeManual').value
    : document.getElementById('hrcNewEmployeeCodeResolved').value
  ).trim();
  if (!employeeCode) {
    return alert(useExternalCode
      ? '⛔ Vui lòng nhập Mã Nhân Viên.'
      : '⛔ Vui lòng gõ và chọn đúng 1 nhân viên từ Hồ Sơ Nhân Sự (hoặc tick "Không lấy từ hồ sơ" để nhập mã ngoài hệ thống).');
  }
  const contractType = document.getElementById('hrcNewContractType').value;
  const startDate = document.getElementById('hrcNewStartDate').value;
  if (!startDate) return alert('⛔ Vui lòng nhập Ngày hiệu lực.');
  const endDate = document.getElementById('hrcNewEndDate').value || null;
  if (contractType !== 'INDEFINITE' && !endDate) return alert('⛔ Vui lòng nhập Ngày hết hạn (chỉ hợp đồng Vô thời hạn mới bỏ trống được).');
  const baseSalary = getMoneyValue(document.getElementById('hrcNewBaseSalary'));
  const responsibilityAllowance = getMoneyValue(document.getElementById('hrcNewResponsibilityAllowance'));
  const concurrentAllowance = getMoneyValue(document.getElementById('hrcNewConcurrentAllowance'));
  const hazardAllowance = getMoneyValue(document.getElementById('hrcNewHazardAllowance'));
  const lunchAllowance = getMoneyValue(document.getElementById('hrcNewLunchAllowance'));
  const transportAllowance = getMoneyValue(document.getElementById('hrcNewTransportAllowance'));
  const phoneAllowance = getMoneyValue(document.getElementById('hrcNewPhoneAllowance'));
  const otherAllowance = getMoneyValue(document.getElementById('hrcNewOtherAllowance'));

  let fileUrl = null, fileName = null;
  const fileInput = document.getElementById('hrcNewFile');
  if (fileInput.files[0]) {
    try {
      const uploaded = await uploadFileToServer(fileInput.files[0], 'hrContract');
      fileUrl = uploaded.fileUrl; fileName = uploaded.fileName || fileInput.files[0].name;
    } catch (err) {
      return alert('⛔ Tải tệp thất bại: ' + err.message);
    }
  }

  let customData;
  try {
    customData = await collectDynamicFieldsData('LABOR_CONTRACT');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  try {
    const result = await callCreateAction('laborContracts', {
      employeeCode, useExternalCode, contractType, startDate, endDate, baseSalary,
      responsibilityAllowance, concurrentAllowance, hazardAllowance, lunchAllowance,
      transportAllowance, phoneAllowance, otherAllowance,
      fileUrl, fileName, customData
    });
    hrcApplyUpdate(result.item);
    closeHrContractCreateModal();
    alert('✅ Đã tạo hợp đồng lao động.');
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

// ===== Chi tiết + thao tác =====
function findHrContractById(id) {
  return (DB.laborContracts || []).find(c => c.id === Number(id)) || null;
}

function openHrContractDetailModal(id) {
  const c = findHrContractById(id);
  if (!c) return;
  document.getElementById('hrcDetailBody').innerHTML = buildHrContractDetailHTML(c);
  document.getElementById('hrContractDetailModal').classList.remove('hidden');
}
function closeHrContractDetailModal() {
  document.getElementById('hrContractDetailModal').classList.add('hidden');
}

const HRC_ALLOWANCE_FIELDS = [
  ['responsibilityAllowance', 'Phụ cấp trách nhiệm'],
  ['concurrentAllowance', 'Phụ cấp kiêm nhiệm'],
  ['hazardAllowance', 'Phụ cấp độc hại nặng nhọc'],
  ['lunchAllowance', 'Phụ cấp ăn trưa'],
  ['transportAllowance', 'Hỗ trợ đi lại'],
  ['phoneAllowance', 'Hỗ trợ điện thoại'],
  ['otherAllowance', 'Phụ cấp/Hỗ trợ khác']
];
// Map field -> id ô sửa dùng chung cho khối DRAFT lẫn ACTIVE (saveHrContractEdit() đọc theo id này).
const HRC_ALLOWANCE_EDIT_ID_PREFIX = 'hrcEditAllowance_';

// HRC_INCOME_FIELDS (10/2026, báo cáo rà soát mẫu Excel mới) — 3 khoản thu nhập MỚI, CÙNG khuôn hiển
// thị/sửa như HRC_ALLOWANCE_FIELDS ngay trên nhưng KHÁC NHÓM nghiệp vụ (không phải phụ cấp) — xem chú
// thích INCOME_FIELDS ở lib/laborContract.js.
const HRC_INCOME_FIELDS = [
  ['socialInsuranceSalary', 'Mức lương đóng BHXH'],
  ['productivityBonus', 'Thưởng HQCV/Lương Năng suất'],
  ['otherIncome', 'Khoản khác']
];
const HRC_INCOME_EDIT_ID_PREFIX = 'hrcEditIncome_';
const HRC_PROBATION_RATE_EDIT_ID = 'hrcEditProbationSalaryRate';

function buildHrContractDetailHTML(c) {
  const fileRow = c.fileUrl
    ? `<a href="${attachmentDownloadUrl(c.fileUrl, null, c.fileName)}" target="_blank" class="text-teal-600 underline">📎 ${escapeHtml(c.fileName || 'Tệp hợp đồng')}</a>`
    : '<span class="text-gray-400">Chưa có tệp</span>';

  // Mới nhất lên đầu (9/2026, theo yêu cầu người dùng) — dùng parseVNDateTime() (core.js) vì createdAt
  // là chuỗi "HH:mm:ss d/M/yyyy" (nowVN()), không sort đúng bằng so sánh chuỗi trực tiếp.
  const sortedAmendments = (c.amendments || []).slice().sort((x, y) =>
    (parseVNDateTime(y.createdAt)?.getTime() || 0) - (parseVNDateTime(x.createdAt)?.getTime() || 0));
  const amendmentsHTML = sortedAmendments.length
    ? sortedAmendments.map(a => `
        <div class="border rounded p-2 bg-gray-50">
          <div class="font-semibold">${escapeHtml(a.amendmentType)}${a.applyDate ? ` — áp dụng ${escapeHtml(a.applyDate)}` : ''} — hiệu lực ${escapeHtml(a.effectiveDate)}</div>
          ${a.oldValue || a.newValue ? `<div class="text-gray-600">${escapeHtml(a.oldValue || '')} → ${escapeHtml(a.newValue || '')}</div>` : ''}
          ${a.note ? `<div class="text-gray-500 italic">${escapeHtml(a.note)}</div>` : ''}
          ${a.fileUrl ? `<div><a href="${attachmentDownloadUrl(a.fileUrl, null, a.fileName)}" target="_blank" class="text-teal-600 underline">📎 ${escapeHtml(a.fileName || 'Quyết định')}</a></div>` : ''}
          <div class="text-gray-400 text-[10px]">${escapeHtml(a.createdByName || a.createdBy)} — ${escapeHtml(a.createdAt)}</div>
        </div>
      `).join('')
    : '<p class="text-gray-400">Chưa có thay đổi nào.</p>';

  // Phụ cấp/Hỗ trợ (GĐ1, 10/2026 — đối chiếu Excel quản lý thủ công Nhân Sự): THÔNG TIN THAM KHẢO,
  // KHÔNG dùng để tính Lương (xem lib/payroll.js chỉ đọc contract.baseSalary) — chỉ hiện khi có ít
  // nhất 1 giá trị để tránh rối màn với hợp đồng cũ chưa dùng tính năng này.
  const allowanceRows = HRC_ALLOWANCE_FIELDS.filter(([f]) => c[f] != null);
  const allowancesSummaryHTML = allowanceRows.length ? `
    <div class="col-span-2 border-t pt-2 mt-1">
      <div class="text-gray-500 text-[11px] mb-1">Phụ cấp/Hỗ trợ (tham khảo, không tính vào Lương):</div>
      <div class="grid grid-cols-2 gap-1">
        ${allowanceRows.map(([f, label]) => `<div><span class="text-gray-500">${escapeHtml(label)}:</span> ${formatMoneyDisplay(c[f])}đ</div>`).join('')}
      </div>
    </div>` : '';
  // incomeRows/probationSalaryRate (10/2026, báo cáo rà soát mẫu Excel mới) — cùng khuôn allowanceRows
  // ngay trên, hiển thị gộp khi có ít nhất 1 giá trị.
  const incomeRows = HRC_INCOME_FIELDS.filter(([f]) => c[f] != null);
  const incomeSummaryHTML = (incomeRows.length || c.probationSalaryRate != null) ? `
    <div class="col-span-2 border-t pt-2 mt-1">
      <div class="text-gray-500 text-[11px] mb-1">Thu nhập khác (tham khảo, không tính vào Lương):</div>
      <div class="grid grid-cols-2 gap-1">
        ${incomeRows.map(([f, label]) => `<div><span class="text-gray-500">${escapeHtml(label)}:</span> ${formatMoneyDisplay(c[f])}đ</div>`).join('')}
        ${c.probationSalaryRate != null ? `<div><span class="text-gray-500">Tỷ lệ lương thử việc:</span> ${c.probationSalaryRate}%</div>` : ''}
      </div>
    </div>` : '';
  const allowancesEditHTML = `
    <details class="mt-2">
      <summary class="text-[11px] text-gray-600 cursor-pointer select-none">➕/✏️ Phụ Cấp / Hỗ Trợ (tuỳ chọn, tham khảo — không ảnh hưởng tính Lương)</summary>
      <div class="grid grid-cols-2 gap-2 mt-1.5">
        ${HRC_ALLOWANCE_FIELDS.map(([f, label]) => `
          <div>
            <label class="block text-[11px] text-gray-500 mb-0.5">${escapeHtml(label)} (đ)</label>
            <input type="text" inputmode="numeric" id="${HRC_ALLOWANCE_EDIT_ID_PREFIX}${f}" value="${c[f] != null ? formatMoneyDisplay(c[f]) : ''}" class="w-full border p-1.5 rounded money-input text-[12px]">
          </div>`).join('')}
        ${HRC_INCOME_FIELDS.map(([f, label]) => `
          <div>
            <label class="block text-[11px] text-gray-500 mb-0.5">${escapeHtml(label)} (đ)</label>
            <input type="text" inputmode="numeric" id="${HRC_INCOME_EDIT_ID_PREFIX}${f}" value="${c[f] != null ? formatMoneyDisplay(c[f]) : ''}" class="w-full border p-1.5 rounded money-input text-[12px]">
          </div>`).join('')}
        <div>
          <label class="block text-[11px] text-gray-500 mb-0.5">Tỷ lệ lương thử việc</label>
          <select id="${HRC_PROBATION_RATE_EDIT_ID}" class="w-full border p-1.5 rounded text-[12px] bg-white">
            <option value="">-- Chưa rõ --</option>
            <option value="85" ${c.probationSalaryRate === 85 ? 'selected' : ''}>85%</option>
            <option value="100" ${c.probationSalaryRate === 100 ? 'selected' : ''}>100%</option>
          </select>
        </div>
      </div>
    </details>`;

  const activateBtn = c.status === 'DRAFT'
    ? `<button type="button" data-op="activateHrContract" data-arg0="${c.id}" class="bg-teal-600 text-white px-3 py-1.5 rounded font-semibold hover:bg-teal-700">✅ Kích Hoạt Hợp Đồng</button>`
    : '';
  const closeBtn = c.status === 'ACTIVE'
    ? `<button type="button" data-op="closeHrContractManual" data-arg0="${c.id}" class="bg-red-600 text-white px-3 py-1.5 rounded font-semibold hover:bg-red-700">⛔ Đóng Hợp Đồng (Chấm Dứt)</button>`
    : '';
  const deleteBtn = currentUser?.perms?.admin
    ? `<button type="button" data-op="deleteHrContractRecord" data-arg0="${c.id}" class="bg-gray-500 text-white px-3 py-1.5 rounded font-semibold hover:bg-gray-600">🗑️ Xoá (Admin)</button>`
    : '';

  return `
    <div class="grid grid-cols-2 gap-2 bg-gray-50 p-3 rounded">
      <div><span class="text-gray-500">Mã HĐ:</span> <span class="font-mono font-semibold">${escapeHtml(c.code || '')}</span></div>
      <div><span class="text-gray-500">Mã NV:</span> <span class="font-semibold">${escapeHtml(c.employeeCode || '')}</span></div>
      <div><span class="text-gray-500">Loại HĐ:</span> ${escapeHtml(HRC_CONTRACT_TYPE_LABELS[c.contractType] || c.contractType)}</div>
      <div><span class="text-gray-500">Trạng thái:</span> ${escapeHtml(HRC_STATUS_LABELS[c.status] || c.status)}</div>
      <div><span class="text-gray-500">Ngày hiệu lực:</span> ${escapeHtml(c.startDate || '')}</div>
      <div><span class="text-gray-500">Ngày hết hạn:</span> ${escapeHtml(c.endDate || '(Vô thời hạn)')}${hrcExpiryBadgeHtml(c)}</div>
      <div><span class="text-gray-500">Lương cơ bản:</span> ${c.baseSalary != null ? formatMoneyDisplay(c.baseSalary) + 'đ' : '(chưa điền)'}</div>
      <div><span class="text-gray-500">Tệp:</span> ${fileRow}</div>
      ${c.status === 'TERMINATED' ? `<div class="col-span-2"><span class="text-gray-500">Lý do chấm dứt:</span> ${escapeHtml(c.terminationReason || '')} (${escapeHtml(c.terminationDate || '')})</div>` : ''}
      ${allowancesSummaryHTML}
      ${incomeSummaryHTML}
    </div>

    ${c.status === 'DRAFT' ? `
    <div class="border rounded p-2">
      <div class="font-semibold mb-1">✏️ Hoàn thiện trước khi kích hoạt</div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="block text-gray-600 mb-1">Ngày hết hạn</label><input type="date" id="hrcEditEndDate" value="${escapeHtml(c.endDate || '')}" class="w-full border p-1.5 rounded"></div>
        <div><label class="block text-gray-600 mb-1">Lương cơ bản (đ)</label><input type="text" inputmode="numeric" id="hrcEditBaseSalary" value="${c.baseSalary != null ? formatMoneyDisplay(c.baseSalary) : ''}" class="w-full border p-1.5 rounded money-input"></div>
      </div>
      ${allowancesEditHTML}
      <button type="button" data-op="saveHrContractEdit" data-arg0="${c.id}" class="mt-2 bg-blue-600 text-white px-3 py-1.5 rounded text-[11px] font-semibold hover:bg-blue-700">💾 Lưu Thay Đổi</button>
    </div>` : ''}

    <!-- LỖI ĐÃ VÁ (rà soát chuyên sâu Nhân Sự, 9/2026): trước đây field "Lương cơ bản" CHỈ sửa được
         lúc hợp đồng còn DRAFT — hợp đồng ACTIVE (đa số thời gian sống thật của 1 hợp đồng) không có
         cách nào cập nhật lại baseSalary ngoài "➕ Thêm Thay Đổi" bên dưới, nhưng phụ lục đó CHỈ ghi
         log văn bản (amendments[]), KHÔNG đụng vào contract.baseSalary — HR tưởng đã "tăng lương" vì
         thấy phụ lục hiện ra, nhưng mọi kỳ Lương sau đó vẫn tính theo baseSalary CŨ vô thời hạn, không
         cảnh báo gì (xem lib/payroll.js::computeEmployeePayslip() đọc thẳng contract.baseSalary). Server
         (applyManualEdit()/route POST .../edit) vốn đã hỗ trợ sửa baseSalary ở BẤT KỲ trạng thái nào và
         tự ghi history — chỉ thiếu đúng 1 khối UI này để dùng tới. -->
    ${c.status === 'ACTIVE' ? `
    <div class="border border-blue-300 rounded p-2 bg-blue-50">
      <div class="font-semibold mb-1 text-blue-900">💰 Cập Nhật Lương Cơ Bản</div>
      <p class="text-[11px] text-blue-800 mb-1.5">Đây là cách DUY NHẤT thay đổi số tiền hệ thống dùng để tính Lương hàng tháng — mục "➕ Thêm Thay Đổi" bên dưới chỉ ghi lại lịch sử/văn bản, KHÔNG tự cập nhật số này.</p>
      <div><label class="block text-gray-600 mb-1">Lương cơ bản mới (đ)</label><input type="text" inputmode="numeric" id="hrcEditBaseSalary" value="${c.baseSalary != null ? formatMoneyDisplay(c.baseSalary) : ''}" class="w-full border p-1.5 rounded money-input"></div>
      ${allowancesEditHTML}
      <button type="button" data-op="saveHrContractEdit" data-arg0="${c.id}" class="mt-2 bg-blue-600 text-white px-3 py-1.5 rounded text-[11px] font-semibold hover:bg-blue-700">💾 Lưu Lương Cơ Bản</button>
    </div>` : ''}

    <div class="flex flex-wrap gap-2">${activateBtn}${closeBtn}${deleteBtn}</div>

    <div class="border-t pt-2">
      <div class="font-semibold mb-1">📋 Lịch Sử Thay Đổi (Phụ Lục)</div>
      <p class="text-[11px] text-gray-500 mb-1.5">Phần này chỉ LƯU LẠI văn bản/lịch sử thay đổi để tra cứu — không tự cập nhật Lương cơ bản hay bất kỳ field nào khác của hợp đồng. Muốn đổi Lương cơ bản thật sự dùng để tính Lương, dùng khối "💰 Cập Nhật Lương Cơ Bản" ở trên.</p>
      <div class="space-y-1 mb-2">${amendmentsHTML}</div>
      <input type="text" id="hrcNewAmendmentType" placeholder="Loại thay đổi (VD: Tăng lương)" class="w-full border p-1.5 rounded mb-2">
      <!-- "Ngày áp dụng" (quyết định được áp dụng/ban hành từ ngày nào) KHÁC "Ngày hiệu lực" (thời điểm
           thay đổi THẬT SỰ có hiệu lực — có thể trễ hơn ngày áp dụng, VD quyết định tăng lương ký/áp
           dụng 1 ngày nhưng hiệu lực từ đầu tháng sau) — 2 khái niệm riêng theo yêu cầu người dùng
           (9/2026), cả 2 đều TUỲ CHỌN trừ Ngày hiệu lực (bắt buộc, xem assertValidAmendment() ở
           lib/laborContract.js). -->
      <div class="grid grid-cols-2 gap-2 mb-2">
        <div><label class="block text-[11px] text-gray-500 mb-0.5">Ngày áp dụng</label><input type="date" id="hrcNewAmendmentApplyDate" class="w-full border p-1.5 rounded"></div>
        <div><label class="block text-[11px] text-gray-500 mb-0.5">Ngày hiệu lực <span class="text-red-500">*</span></label><input type="date" id="hrcNewAmendmentDate" class="w-full border p-1.5 rounded"></div>
      </div>
      <!-- Checkbox tường minh (9/2026, thay cho đoán theo nội dung "Loại thay đổi" — không đáng tin, xem
           chú thích toggleHrcAmendmentMoneyMode()) — mặc định BẬT vì đa số phụ lục liên quan lương. -->
      <label class="flex items-center gap-1.5 text-[11px] text-gray-600 mb-1">
        <input type="checkbox" id="hrcNewAmendmentIsMoney" checked data-op-change="toggleHrcAmendmentMoneyMode">
        💰 Giá trị tiền (tự định dạng dấu chấm phân cách hàng nghìn khi gõ — bỏ tick nếu gõ chữ tự do, VD đổi chức danh)
      </label>
      <div class="grid grid-cols-2 gap-2">
        <input type="text" inputmode="numeric" id="hrcNewAmendmentOld" placeholder="Giá trị cũ (đ)" class="border p-1.5 rounded money-input">
        <input type="text" inputmode="numeric" id="hrcNewAmendmentNew" placeholder="Giá trị mới (đ)" class="border p-1.5 rounded money-input">
      </div>
      <textarea id="hrcNewAmendmentNote" placeholder="Ghi chú" class="w-full border p-1.5 rounded mt-2"></textarea>
      <div class="mt-2">
        <label class="block text-gray-600 mb-1 text-[11px]">Quyết định đính kèm (tuỳ chọn)</label>
        <input type="file" id="hrcNewAmendmentFile" accept=".pdf,.docx,.jpg,.jpeg,.png" class="w-full border p-1 bg-white rounded text-[11px]">
      </div>
      <button type="button" data-op="submitHrContractAmendment" data-arg0="${c.id}" class="mt-2 bg-teal-600 text-white px-3 py-1.5 rounded text-[11px] font-semibold hover:bg-teal-700">➕ Thêm Thay Đổi</button>
    </div>
  `;
}

// Chỉ gửi lên đúng field ĐANG CÓ trên form hiện tại (khối DRAFT có cả 2 ô, khối ACTIVE chỉ có riêng
// Lương cơ bản) — trước đây luôn gửi cả "endDate", nếu tái dùng hàm này cho form chỉ có 1 ô sẽ vô tình
// gửi endDate=null và XOÁ MẤT ngày hết hạn hợp đồng đang có (applyManualEdit() coi field có mặt trong
// payload, dù giá trị null, là "xoá field đó" — xem MANUAL_EDITABLE_FIELDS).
async function saveHrContractEdit(id) {
  const payload = {};
  const endDateEl = document.getElementById('hrcEditEndDate');
  if (endDateEl) payload.endDate = endDateEl.value || null;
  const baseSalaryEl = document.getElementById('hrcEditBaseSalary');
  if (baseSalaryEl) payload.baseSalary = getMoneyValue(baseSalaryEl);
  for (const [f] of HRC_ALLOWANCE_FIELDS) {
    const el = document.getElementById(HRC_ALLOWANCE_EDIT_ID_PREFIX + f);
    if (el) payload[f] = getMoneyValue(el);
  }
  for (const [f] of HRC_INCOME_FIELDS) {
    const el = document.getElementById(HRC_INCOME_EDIT_ID_PREFIX + f);
    if (el) payload[f] = getMoneyValue(el);
  }
  const probationRateEl = document.getElementById(HRC_PROBATION_RATE_EDIT_ID);
  if (probationRateEl) payload.probationSalaryRate = probationRateEl.value === '' ? null : Number(probationRateEl.value);
  try {
    const result = await callRecordAction('laborContracts', id, 'edit', payload);
    hrcApplyUpdate(result.item);
    openHrContractDetailModal(id);
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

async function activateHrContract(id) {
  if (!confirm('Kích hoạt hợp đồng này? Hợp đồng ACTIVE khác (nếu có) của cùng nhân viên sẽ tự đóng.')) return;
  try {
    const result = await callRecordAction('laborContracts', id, 'activate', {});
    hrcApplyUpdate(result.item);
    openHrContractDetailModal(id);
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

async function closeHrContractManual(id) {
  const reason = prompt('Lý do chấm dứt hợp đồng:');
  if (reason === null) return;
  try {
    const result = await callRecordAction('laborContracts', id, 'status', { status: 'TERMINATED', terminationReason: reason });
    hrcApplyUpdate(result.item);
    openHrContractDetailModal(id);
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

async function submitHrContractAmendment(id) {
  const amendmentType = document.getElementById('hrcNewAmendmentType').value.trim();
  const effectiveDate = document.getElementById('hrcNewAmendmentDate').value;
  if (!amendmentType || !effectiveDate) return alert('⛔ Vui lòng nhập Loại thay đổi và Ngày hiệu lực.');
  const applyDate = document.getElementById('hrcNewAmendmentApplyDate').value || null;
  const oldValue = document.getElementById('hrcNewAmendmentOld').value.trim();
  const newValue = document.getElementById('hrcNewAmendmentNew').value.trim();
  const note = document.getElementById('hrcNewAmendmentNote').value.trim();
  // Quyết định đính kèm (tuỳ chọn) — cùng khuôn tệp hợp đồng gốc lúc tạo (uploadFileToServer('hrContract')
  // ở trên), giúp tra soát lịch sử thay đổi lương/chức vụ có văn bản quyết định đi kèm.
  let fileUrl = null, fileName = null;
  const fileInput = document.getElementById('hrcNewAmendmentFile');
  if (fileInput?.files[0]) {
    try {
      const uploaded = await uploadFileToServer(fileInput.files[0], 'hrContract');
      fileUrl = uploaded.fileUrl; fileName = uploaded.fileName || fileInput.files[0].name;
    } catch (err) {
      return alert('⛔ Tải tệp quyết định thất bại: ' + err.message);
    }
  }
  try {
    const result = await callRecordAction('laborContracts', id, 'add-amendment', { amendmentType, effectiveDate, applyDate, oldValue, newValue, note, fileUrl, fileName });
    hrcApplyUpdate(result.item);
    openHrContractDetailModal(id);
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

async function deleteHrContractRecord(id) {
  if (!confirm('Xoá vĩnh viễn hợp đồng này? Không thể hoàn tác.')) return;
  try {
    await callRecordAction('laborContracts', id, 'delete', {});
    DB.laborContracts = (DB.laborContracts || []).filter(c => c.id !== Number(id));
    closeHrContractDetailModal();
    renderHrContractTable();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

// ===== Nhập Excel hàng loạt (10/2026) — CHỈ sửa hợp đồng ACTIVE đã có (xem lib/laborContractImport.js),
// cùng khuôn modal hrpfImportModal (module-hrprofile.js: chọn file -> xem trước -> xác nhận). Mỗi dòng
// hợp lệ gửi lên POST /api/records/laborContracts/apply-import, server tự validate lại từ đầu.
let hrContractImportPreviewItems = [];

function openHrContractImportModal() {
  document.getElementById('hrContractImportFile').value = '';
  document.getElementById('hrContractImportStatus').innerText = '';
  hrContractImportPreviewItems = [];
  document.getElementById('hrContractImportPreviewWrap').classList.add('hidden');
  document.getElementById('hrContractImportConfirmBtn').classList.add('hidden');
  document.getElementById('hrContractImportModal').classList.remove('hidden');
}
function closeHrContractImportModal() {
  document.getElementById('hrContractImportModal').classList.add('hidden');
}

async function onHrContractImportFileChange(event) {
  const file = event.target.files[0];
  hrContractImportPreviewItems = [];
  document.getElementById('hrContractImportPreviewWrap').classList.add('hidden');
  document.getElementById('hrContractImportConfirmBtn').classList.add('hidden');
  const statusEl = document.getElementById('hrContractImportStatus');
  if (!file) { statusEl.innerText = ''; return; }
  statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/labor-contracts/parse-import', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    // Mặc định: dòng hợp lệ + không trùng -> included=true (sẽ áp dụng); dòng trùng ngay trong file (chỉ
    // dòng ĐẦU được giữ included=true, các dòng lặp lại SAU đó mặc định included=false, tự tick lại nếu
    // vẫn muốn áp dụng) — cùng tinh thần "cảnh báo trước, người dùng tự xác nhận" ở lib/importDedup.js.
    data.items.forEach((it, idx) => {
      it._idx = idx;
      it.included = it.valid && !it.duplicateInFile;
    });
    hrContractImportPreviewItems = data.items;
    const validCount = data.items.filter(it => it.valid).length;
    const dupCount = data.items.filter(it => it.duplicateInFile).length;
    statusEl.innerText = `✅ Đọc file "${data.fileName}": ${validCount}/${data.items.length} dòng hợp lệ`
      + (dupCount ? `, ${dupCount} dòng TRÙNG MÃ NHÂN VIÊN ngay trong file (đã bỏ chọn sẵn, tự tick lại nếu vẫn muốn áp dụng).` : '.');
    document.getElementById('hrContractImportPreviewBody').innerHTML = data.items.map((it) => {
      let statusCell;
      if (!it.valid) {
        statusCell = `<span class="text-red-600">⛔ ${escapeHtml(it.errors.join('; '))}</span>`;
      } else {
        statusCell = `<label class="text-xs"><input type="checkbox" data-op-change="onHrContractImportRowToggle" data-arg0="${it._idx}" ${it.included ? 'checked' : ''}> Áp dụng</label>`
          + (it.duplicateInFile ? ' <span class="text-amber-700">⚠️ Trùng mã trong file</span>' : '');
      }
      return `<tr class="${!it.valid || it.duplicateInFile ? 'bg-amber-50' : ''}">
        <td class="p-1 font-mono">${escapeHtml(it.employeeCode)}</td>
        <td class="p-1">${escapeHtml(it.fullName || '')}</td>
        <td class="p-1">${it.valid ? Object.keys(it.fields).length : '-'}</td>
        <td class="p-1">${statusCell}</td>
      </tr>`;
    }).join('');
    document.getElementById('hrContractImportPreviewWrap').classList.remove('hidden');
    if (validCount > 0) document.getElementById('hrContractImportConfirmBtn').classList.remove('hidden');
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
    event.target.value = '';
  }
}

function onHrContractImportRowToggle(idxStr) {
  const it = hrContractImportPreviewItems.find(x => x._idx === Number(idxStr));
  if (it) it.included = !it.included;
}

// Route áp dụng hàng loạt KHÔNG theo khuôn "1 bản ghi cụ thể" của callRecordAction() (xây dựng URL
// /api/records/<module>/<id>/<action>) — gọi fetch() thẳng, cùng khuôn loadHrcEmployeeDirectory() ở trên.
async function confirmHrContractImport() {
  const submitItems = hrContractImportPreviewItems.filter(it => it.valid && it.included);
  if (!submitItems.length) return alert('Chưa chọn dòng nào để áp dụng.');
  try {
    const res = await fetch('/api/records/laborContracts/apply-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: submitItems.map(it => ({ employeeCode: it.employeeCode, fields: it.fields })) })
    });
    if (res.status === 401) { handleSessionExpired(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Lỗi máy chủ (HTTP ${res.status})`);
    (data.updated || []).forEach(hrcApplyUpdate);
    let msg = `✅ Đã cập nhật ${data.updated.length}/${submitItems.length} hợp đồng.`;
    if (data.skipped.length) {
      msg += `\n\n⛔ ${data.skipped.length} dòng bị bỏ qua:\n` + data.skipped.map(s => `- ${s.employeeCode}: ${s.reason}`).join('\n');
    }
    alert(msg);
    closeHrContractImportModal();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}

// ===== Nhập Excel TẠO MỚI hàng loạt (10/2026) — khoá/match theo Mã Nhân Viên; mã ĐÃ có hợp đồng ACTIVE
// thì người dùng tự chọn Ghi đè/Huỷ cho dòng đó (mặc định an toàn: Huỷ) — xem
// lib/laborContractCreateImport.js. Cùng khuôn modal Nhập Excel sửa hàng loạt ở trên, khác ở việc mỗi
// dòng xem trước có 1 selector hành động (Tạo mới/Ghi đè/Huỷ) thay vì 1 checkbox đơn.
let hrContractCreateImportPreviewItems = [];

function openHrContractCreateImportModal() {
  document.getElementById('hrContractCreateImportFile').value = '';
  document.getElementById('hrContractCreateImportStatus').innerText = '';
  hrContractCreateImportPreviewItems = [];
  document.getElementById('hrContractCreateImportPreviewWrap').classList.add('hidden');
  document.getElementById('hrContractCreateImportConfirmBtn').classList.add('hidden');
  document.getElementById('hrContractCreateImportModal').classList.remove('hidden');
}
function closeHrContractCreateImportModal() {
  document.getElementById('hrContractCreateImportModal').classList.add('hidden');
}

function renderHrContractCreateImportPreviewBody() {
  document.getElementById('hrContractCreateImportPreviewBody').innerHTML = hrContractCreateImportPreviewItems.map((it) => {
    let actionCell;
    let statusCell = '';
    if (!it.valid) {
      actionCell = '<span class="text-gray-400">—</span>';
      statusCell = `<span class="text-red-600">⛔ ${escapeHtml(it.errors.join('; '))}</span>`;
    } else if (it.hasActiveContract) {
      actionCell = `<select data-op-change="onHrContractCreateImportRowActionChange" data-arg0="${it._idx}" data-arg-value="1" class="border rounded px-1 py-0.5 text-[11px]">
        <option value="skip" ${it.action === 'skip' ? 'selected' : ''}>Huỷ (giữ nguyên)</option>
        <option value="overwrite" ${it.action === 'overwrite' ? 'selected' : ''}>Ghi đè hợp đồng ACTIVE</option>
      </select>`;
      statusCell = `<span class="text-amber-700">⚠️ Đã có hợp đồng ACTIVE [${escapeHtml(it.existingActiveCode || '')}]</span>`;
    } else if (it.duplicateInFile) {
      // Trùng mã NGAY TRONG FILE đang nhập (chưa chắc đã có trong hệ thống) — theo yêu cầu người dùng
      // (10/2026), KHÔNG cho chọn "Tạo mới" ở đây nữa (tránh tạo 2 hợp đồng DRAFT cùng Mã Nhân Viên do
      // gõ/copy nhầm dòng) — chỉ còn Huỷ, không có selector để tránh hiểu lầm có lựa chọn khác.
      actionCell = '<span class="text-gray-500 italic">Huỷ (trùng mã trong file)</span>';
      statusCell = '<span class="text-amber-700">⚠️ Trùng mã trong file — sửa file để tách dòng nếu vẫn muốn tạo cả 2</span>';
    } else {
      actionCell = `<select data-op-change="onHrContractCreateImportRowActionChange" data-arg0="${it._idx}" data-arg-value="1" class="border rounded px-1 py-0.5 text-[11px]">
        <option value="add" ${it.action === 'add' ? 'selected' : ''}>Tạo mới</option>
        <option value="skip" ${it.action === 'skip' ? 'selected' : ''}>Huỷ (bỏ qua)</option>
      </select>`;
      statusCell = '<span class="text-green-700">✅ Sẵn sàng tạo mới</span>';
    }
    return `<tr class="${!it.valid || it.hasActiveContract || it.duplicateInFile ? 'bg-amber-50' : ''}">
      <td class="p-1 font-mono">${escapeHtml(it.employeeCode)}</td>
      <td class="p-1">${escapeHtml(it.fullName || '')}</td>
      <td class="p-1">${it.valid ? escapeHtml(HRC_CONTRACT_TYPE_LABELS[it.fields.contractType] || it.fields.contractType || '') : '-'}</td>
      <td class="p-1">${actionCell}</td>
      <td class="p-1">${statusCell}</td>
    </tr>`;
  }).join('');
}

async function onHrContractCreateImportFileChange(event) {
  const file = event.target.files[0];
  hrContractCreateImportPreviewItems = [];
  document.getElementById('hrContractCreateImportPreviewWrap').classList.add('hidden');
  document.getElementById('hrContractCreateImportConfirmBtn').classList.add('hidden');
  const statusEl = document.getElementById('hrContractCreateImportStatus');
  if (!file) { statusEl.innerText = ''; return; }
  statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/labor-contracts/parse-create-import', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    // Mặc định an toàn (cùng tinh thần module-hrprofile.js): dòng hợp lệ + KHÔNG trùng (không có hợp
    // đồng ACTIVE, không trùng ngay trong file) -> action='add'; mọi dòng còn lại -> 'skip', người dùng
    // tự đổi lại qua selector nếu vẫn muốn Ghi đè/Tạo mới.
    data.items.forEach((it, idx) => {
      it._idx = idx;
      it.action = (it.valid && !it.hasActiveContract && !it.duplicateInFile) ? 'add' : 'skip';
    });
    hrContractCreateImportPreviewItems = data.items;
    const addableCount = data.items.filter(it => it.valid && !it.hasActiveContract).length;
    const dupActiveCount = data.items.filter(it => it.valid && it.hasActiveContract).length;
    const dupFileCount = data.items.filter(it => it.duplicateInFile).length;
    statusEl.innerText = `✅ Đọc file "${data.fileName}": ${data.items.length} dòng, ${addableCount} dòng sẵn sàng tạo mới`
      + (dupActiveCount ? `, ${dupActiveCount} dòng ĐÃ có hợp đồng ACTIVE (tự chọn Ghi đè/Huỷ).` : '.')
      + (dupFileCount ? ` ${dupFileCount} dòng trùng mã trong file.` : '');
    renderHrContractCreateImportPreviewBody();
    document.getElementById('hrContractCreateImportPreviewWrap').classList.remove('hidden');
    if (data.items.some(it => it.valid)) document.getElementById('hrContractCreateImportConfirmBtn').classList.remove('hidden');
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
    event.target.value = '';
  }
}

function onHrContractCreateImportRowActionChange(idxStr, action) {
  const it = hrContractCreateImportPreviewItems.find(x => x._idx === Number(idxStr));
  if (it) it.action = action;
}

async function confirmHrContractCreateImport() {
  const submitItems = hrContractCreateImportPreviewItems.filter(it => it.valid && it.action !== 'skip');
  if (!submitItems.length) return alert('Chưa có dòng nào được chọn Tạo mới/Ghi đè.');
  try {
    const res = await fetch('/api/records/laborContracts/apply-create-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: submitItems.map(it => ({ employeeCode: it.employeeCode, action: it.action, fields: it.fields })) })
    });
    if (res.status === 401) { handleSessionExpired(); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Lỗi máy chủ (HTTP ${res.status})`);
    (data.created || []).forEach(hrcApplyUpdate);
    (data.updated || []).forEach(hrcApplyUpdate);
    let msg = `✅ Đã tạo mới ${data.created.length} hợp đồng, ghi đè ${data.updated.length} hợp đồng.`;
    if (data.skipped.length) {
      msg += `\n\n⛔ ${data.skipped.length} dòng bị bỏ qua:\n` + data.skipped.map(s => `- ${s.employeeCode}: ${s.reason}`).join('\n');
    }
    alert(msg);
    closeHrContractCreateImportModal();
  } catch (err) {
    alert('⛔ ' + err.message);
  }
}
