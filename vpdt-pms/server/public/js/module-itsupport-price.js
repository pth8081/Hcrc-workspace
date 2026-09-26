// ==========================================
// HỖ TRỢ IT — "🏷️ Phê Duyệt Giá" (duyệt giá bán mặt hàng siêu thị theo phòng ban, dùng chung engine
// dept-workflow ở lib/workflowEngine.js — xem docs/carRegs) + "🎫 Hỗ Trợ Yêu Cầu" (ticket helpdesk IT
// nội bộ, mở cho toàn bộ nhân viên, state machine đơn giản TODO->DOING->DONE/CANCELLED, không qua
// duyệt). 2 sub-module tách biệt hoàn toàn dữ liệu (xem lib/createValidation.js, không chung 1 công
// việc nghiệp vụ nào).
// ==========================================
// modKey "Trường Bổ Sung" (renderDynamicInputsForModule()/collectDynamicFieldsData()) của Phê Duyệt Giá
// — đợt 9/2026 tách khỏi 1 key 'IT_PRICE' chung thành 2 key riêng theo đúng FORM_TABS mới ở core.js
// (IT_PRICE_RETAIL/IT_PRICE_WHOLESALE), khớp field bắt buộc khác nhau thật sự giữa Bán Lẻ/Bán Buôn.
function itPriceDynamicModKey() { return activeItPriceSubTab === 'WHOLESALE' ? 'IT_PRICE_WHOLESALE' : 'IT_PRICE_RETAIL'; }

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
  document.getElementById('btnItSubRenewal').className = (subTab === 'RENEWAL' ? activeCls : inactiveCls) + (canManageItRenewalClient(currentUser) ? '' : ' hidden');

  if (subTab === 'PRICE') {
    // Form tạo đề xuất (Bán Buôn/Bán Lẻ) ĐÃ CHUYỂN khỏi Hỗ Trợ IT (10/2026) sang module-vanhanh.js/
    // module-muahang.js — tab này giờ CHỈ còn xem danh sách + xử lý (Duyệt/Từ chối/Nhận xử lý/Áp giá),
    // không còn khởi tạo form nào ở đây nữa (xem chú thích đầu itSupportSection.html).
    document.getElementById('itPriceMasterListAdminWrap').classList.toggle('hidden', !currentUser.perms?.admin);
    if (currentUser.perms?.admin) renderItPriceMasterListAdmin();
    renderItPriceApprovals();
  }
  if (subTab === 'TICKET') {
    document.getElementById('itTicketCode').value = generateItTicketCode();
    renderDynamicInputsForModule('IT_TICKET', 'dynamicFieldsContainer_IT_TICKET');
    renderItTickets();
  }
  if (subTab === 'RENEWAL') {
    renderDynamicInputsForModule('IT_RENEWAL', 'dynamicFieldsContainer_IT_RENEWAL');
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
    checkItPriceMarginConsistency();
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
  }
}

// Đọc 1 giá trị Margin/Chiết Khấu dạng chuỗi từ file (VD "12%", "12", "12,5%", "-3", "1.234,5") -> số
// thực (%) hoặc null nếu không đọc được thành số.
// LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình — phát hiện #11): .replace(',', '.') cũ chỉ thay
// đúng dấu phẩy ĐẦU TIÊN — số dạng "1.234,5" (dấu chấm phân cách nghìn, dấu phẩy thập phân) ra "1.234.5"
// rồi Number() = NaN, âm thầm bị lọc khỏi mọi tính toán (nums.filter(n => n !== null)) như thể dòng đó
// không hề có margin. Dùng lại ĐÚNG thuật toán tách dấu phân cách nghìn/thập phân đã kiểm thử ở
// parseAmount() (lib/purchasingManualImport.js): dấu THẬP PHÂN là dấu xuất hiện SAU CÙNG trong chuỗi khi
// có cả 2 loại dấu, dấu còn lại là phân cách nghìn (bỏ hẳn).
function parseItPriceMarginNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw).replace(/[^\d.,-]/g, '').trim();
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const thousandSep = decimalSep === '.' ? ',' : '.';
    s = s.split(thousandSep).join('');
    if (decimalSep === ',') s = s.replace(',', '.');
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? '.' : ',';
    const parts = s.split(sep);
    const isThousandsGrouping = parts.length > 2 || (parts.length === 2 && parts[1].length === 3);
    s = isThousandsGrouping ? parts.join('') : parts.join('.');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Đếm số dòng "SAI PHÍA" so với mức đã chọn (mốc 5%) — dùng cho cảnh báo ở checkItPriceMarginConsistency()
// bên dưới. TRƯỚC ĐÂY chỉ so trung bình cộng cả file với mốc 5%, có thể bị vài dòng margin cao che mất
// khi trung bình hoá cùng nhiều dòng thấp (dòng đó đáng ra phải đi quy trình duyệt MARGIN_GTE5 khác) —
// nay đếm TỪNG dòng riêng, cảnh báo nếu BẤT KỲ dòng nào sai phía, không chỉ khi trung bình sai.
function itPriceTierWrongSideCount(tier, nums) {
  if (tier === 'MARGIN_LT5') return nums.filter(n => n >= 5).length;
  if (tier === 'MARGIN_GTE5') return nums.filter(n => n < 5).length;
  if (tier === 'DISCOUNT_LTE5') return nums.filter(n => n > 5).length;
  if (tier === 'DISCOUNT_GT5') return nums.filter(n => n <= 5).length;
  return 0;
}

// Đối chiếu mức Margin/Chiết Khấu người đề xuất TỰ CHỌN (#itPriceTier) với số liệu THẬT trong file bảng
// giá vừa tải lên (chỉ khi Mẫu Giá đã chọn có gán marginColumnKey — xem setItPriceMasterListMarginColumn()
// ở trên) — quyết định nghiệp vụ 9/2026 (task #82): CHỈ hiện CẢNH BÁO cho người gửi nếu trung bình cộng
// số liệu thật có vẻ không khớp mức đã chọn, KHÔNG chặn gửi, KHÔNG ràng buộc người duyệt (người duyệt vẫn
// tự do xử lý y hệt trước đây — hàm này không đụng gì tới luồng server/duyệt). Gọi lại mỗi khi đổi mức áp
// dụng (data-op-change ở #itPriceTier), đổi Mẫu Giá, đọc xong file mới, hoặc reset/đổi sub-tab.
function checkItPriceMarginConsistency() {
  const warnWrap = document.getElementById('itPriceMarginWarningWrap');
  const warnText = document.getElementById('itPriceMarginWarningText');
  if (!warnWrap || !warnText) return;
  const hide = () => warnWrap.classList.add('hidden');
  if (activeItPriceSubTab !== 'WHOLESALE') return hide();
  const tier = document.getElementById('itPriceTier')?.value;
  if (!tier) return hide();
  const masterListId = document.getElementById('itPriceMasterListSelect')?.value;
  const list = masterListId ? (DB.itPriceMasterLists || []).find(m => String(m.id) === masterListId) : null;
  if (!list?.marginColumnKey) return hide();
  const items = itPricePendingFile?.items;
  if (!items || !items.length) return hide();
  const nums = items.map(it => parseItPriceMarginNumber(it.values?.[list.marginColumnKey])).filter(n => n !== null);
  if (!nums.length) return hide();
  // LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình — phát hiện #11): TRƯỚC ĐÂY chỉ so TRUNG BÌNH
  // CỘNG cả file với mốc 5% — vài dòng margin cao (đáng ra đi quy trình duyệt khác, MARGIN_GTE5) có thể
  // bị trung bình hoá che mất nếu đa số dòng khác thấp. Đếm SỐ DÒNG sai phía qua itPriceTierWrongSideCount()
  // ở trên, cảnh báo nếu BẤT KỲ dòng nào vượt mốc, không chỉ khi trung bình vượt (quyết định KHÔNG đổi:
  // vẫn chỉ cảnh báo, không chặn gửi, không ràng buộc người duyệt).
  const wrongCount = itPriceTierWrongSideCount(tier, nums);
  if (!wrongCount) return hide();
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const min = Math.min(...nums), max = Math.max(...nums);
  const colLabel = list.columns.find(c => c.key === list.marginColumnKey)?.label || 'Margin/Chiết Khấu';
  warnText.innerText = `Số liệu cột "${colLabel}" trong file: ${wrongCount}/${nums.length} dòng (nhỏ nhất ${min.toFixed(1)}%, lớn nhất ${max.toFixed(1)}%, trung bình ${avg.toFixed(1)}%) có vẻ KHÔNG khớp với mức "${itPriceTierLabel(tier)}" đã chọn — vui lòng kiểm tra lại trước khi gửi (chỉ để bạn lưu ý, không bắt buộc phải sửa).`;
  warnWrap.classList.remove('hidden');
}

async function onItPriceFileChange(event) {
  // Input này đã có data-op-change nghiệp vụ riêng (đọc/xem trước bảng giá) từ trước khi có mẫu chip
  // "📎 tên file [✕]" dùng chung (xem onSingleFileChosen()/core.js) — 1 input CHỈ nhận 1 data-op-change
  // duy nhất (bindCspDelegation() dùng addEventListener 'change' đơn, không phải mảng) nên KHÔNG thể gắn
  // thêm data-op-change="onSingleFileChosen" song song ở HTML như các input file khác trong đợt UX này
  // — gọi trực tiếp ngay đây để vẫn có chip, không đụng logic đọc file bên dưới.
  onSingleFileChosen(event.target, 'itPriceFileChip');
  const file = event.target.files[0];
  itPricePendingFile = null;
  document.getElementById('itPriceFilePreviewWrap').classList.add('hidden');
  const statusEl = document.getElementById('itPriceFileStatus');
  if (!file) { statusEl.innerText = ''; checkItPriceMarginConsistency(); return; }
  await parseItPriceFileForPreview(file);
  if (!itPricePendingFile) clearSingleFileInput('itPriceFileInput', 'itPriceFileChip'); // dọn luôn chip — khớp lý do ở module-vpp.js onVppCatalogFileChange().
}

// Đổi Mẫu Giá SAU KHI đã chọn sẵn 1 tệp bảng giá — đọc lại tệp đó (còn nguyên trong ô chọn file) để dò
// lại đúng cột theo mẫu mới chọn, không bắt người dùng phải chọn lại tệp.
async function onItPriceMasterListChange() {
  updateItPriceMasterListDownloadLink();
  const fileInput = document.getElementById('itPriceFileInput');
  const file = fileInput?.files?.[0];
  if (!file) { checkItPriceMarginConsistency(); return; }
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
// file), không có nhiều field rời rạc cần gộp lại thành 1 lượt lưu. Cột đọc được từ file mẫu LẤY NGUYÊN
// VĂN, lưu thẳng — CHỈ riêng "Margin/Chiết Khấu" (marginColumnKey, từ 9/2026 task #82) là 1 gán vai trò
// TUỲ CHỌN admin tự chọn thêm sau khi đọc cột xong (xem pickMarginColumnKey() bên dưới).
function renderItPriceMasterListAdmin() {
  const tbody = document.getElementById('itPriceMasterListTableBody');
  if (!tbody) return;
  // Lọc theo đúng kênh đang mở (Bán Lẻ/Bán Buôn, mục 1 kế hoạch tách Mẫu Giá) — mẫu CŨ chưa gắn
  // priceType (tạo trước khi tách kênh) vẫn hiện ở CẢ 2 kênh (không xác định được thuộc kênh nào,
  // an toàn hơn là ẩn hẳn khỏi 1 bên khiến mẫu đang dùng dở "biến mất").
  const lists = (DB.itPriceMasterLists || []).filter(m => !m.priceType || m.priceType === activeItPriceSubTab);
  if (!lists.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center p-4 text-gray-400 italic">Chưa có Mẫu Giá nào — bấm "+ Thêm Mẫu Giá" để nạp.</td></tr>`;
    return;
  }
  tbody.innerHTML = lists.map(m => `
    <tr class="hover:bg-gray-50 border-b">
      <td class="border p-2 font-semibold">${escapeHtml(m.name)}<br><a href="${attachmentDownloadUrl(m.fileUrl, null, m.fileName)}" target="_blank" class="text-[11px] text-sky-600 hover:underline font-normal">📥 ${escapeHtml(m.fileName || '')}</a></td>
      <td class="border p-2">${(m.columns || []).map(c => `<span class="inline-block px-1.5 py-0.5 rounded text-[11px] mr-1 mb-1 ${c.key === m.marginColumnKey ? 'bg-amber-100 text-amber-800 font-bold' : 'bg-gray-100 text-gray-700'}">${escapeHtml(c.label)}${c.key === m.marginColumnKey ? ' 🎯' : ''}</span>`).join('')}
        ${m.marginColumnKey ? '' : '<div class="text-[11px] text-gray-400 italic mt-1">Chưa gán cột Margin/Chiết Khấu</div>'}</td>
      <td class="border p-2">${escapeHtml(m.uploadedByName || '')}<br><span class="text-[11px] text-gray-400">${escapeHtml(m.uploadedAt || '')}</span></td>
      <td class="border p-2 text-center space-x-1 whitespace-nowrap">
        <button type="button" data-op="renameItPriceMasterList" data-arg0="${m.id}" class="px-2 py-1 bg-gray-200 text-gray-700 rounded text-[11px] font-bold hover:bg-gray-300">✏️ Đổi tên</button>
        <button type="button" data-op="setItPriceMasterListMarginColumn" data-arg0="${m.id}" class="px-2 py-1 bg-amber-500 text-white rounded text-[11px] font-bold hover:bg-amber-600">🎯 Cột Margin/CK</button>
        <button type="button" data-op="replaceItPriceMasterListFile" data-arg0="${m.id}" class="px-2 py-1 bg-sky-600 text-white rounded text-[11px] font-bold hover:bg-sky-700">🔄 Thay mẫu</button>
        <button type="button" data-op="deleteItPriceMasterList" data-arg0="${m.id}" class="px-2 py-1 bg-red-600 text-white rounded text-[11px] font-bold hover:bg-red-700">🗑️ Xoá</button>
      </td>
    </tr>
  `).join('');
}

// Cho admin chọn (TUỲ CHỌN) 1 cột trong "columns" đóng vai trò "Margin/Chiết Khấu (%)" — dùng lại modal
// dùng chung "Gán vai trò cột" (#colRoleModal, xem openColumnRoleMappingModal() ở trên) vốn đang KHÔNG
// còn ai gọi tới cho Mẫu Giá từ đợt bỏ "vai trò cột" (task #82 dùng lại ĐÚNG 1 vai trò, không required —
// bấm Hủy modal = coi như không chọn cột nào, KHÔNG huỷ luôn thao tác thêm/thay Mẫu Giá đang làm dở).
// Trả về key cột đã chọn, hoặc null nếu không chọn/bấm Hủy.
async function pickMarginColumnKey(columns) {
  if (!columns || !columns.length) return null;
  const result = await openColumnRoleMappingModal(columns.map(c => c.label), {
    title: '🎯 Chọn Cột Margin/Chiết Khấu (tuỳ chọn)',
    hint: 'Nếu file mẫu này có 1 cột thể hiện % Margin/Chiết Khấu, chọn đúng cột đó để hệ thống tự đối chiếu số liệu thật với mức người đề xuất chọn lúc nộp Bán Buôn — CHỈ hiện cảnh báo cho người gửi nếu có vẻ không khớp, KHÔNG chặn gửi và KHÔNG ràng buộc người duyệt. Để trống (bấm Hủy) nếu không dùng.',
    roles: [{ key: 'margin', label: 'Cột Margin/Chiết Khấu (%)', required: false }]
  });
  if (!result) return null;
  const idx = result.picked?.margin;
  return (idx !== undefined && idx !== '') ? columns[Number(idx)].key : null;
}

async function setItPriceMasterListMarginColumn(id) {
  const list = (DB.itPriceMasterLists || []).find(m => m.id === id);
  if (!list) return;
  const marginColumnKey = await pickMarginColumnKey(list.columns);
  const snapshot = [...(DB.itPriceMasterLists || [])];
  DB.itPriceMasterLists = snapshot.map(m => m.id === id ? { ...m, marginColumnKey } : m);
  const saved = await syncStorage('itPriceMasterLists');
  if (!saved) { DB.itPriceMasterLists = snapshot; return; }
  logSystemAction('IT_SUPPORT', 'SET_IT_PRICE_MARGIN_COLUMN', `Gán cột Margin/Chiết Khấu cho Mẫu Giá "${list.name}"${marginColumnKey ? '' : ' (bỏ gán)'}`, 'SUCCESS');
  renderItPriceMasterListAdmin();
}

// Đọc + parse 1 file Excel mẫu qua route riêng (admin-only) — CHỈ trả về khuôn cột (columns), không có
// dữ liệu — Promise<{columns,fileUrl,fileName}> hoặc null nếu người dùng bấm Hủy chọn file/có lỗi (đã
// tự alert).
// LỖI ĐÃ VÁ (báo cáo 10/2026 — "ấn + Thêm Mẫu Giá không có phản ứng" ở CẢ Bán Lẻ/Bán Buôn): đây là input
// file DUY NHẤT trong toàn hệ thống KHÔNG dùng data-op-change (mọi input file khác đều bind trực tiếp
// qua bindCspDelegation, xem itPriceFileInput/vppCatalogFileInput...) mà dựng riêng 1 Promise, chỉ
// resolve() khi bắt được sự kiện "change" (chọn xong file). Hộp thoại chọn file của hệ điều hành KHÔNG
// bao giờ bắn "change" nếu người dùng bấm Hủy/đóng đi — trước đây thiếu xử lý "cancel" nên Promise treo
// VĨNH VIỄN, kéo theo el.dataset.opInFlight của nút gọi hàm này (gán trong runCspOp(), xem core.js) cũng
// treo mãi — nút "+ Thêm Mẫu Giá"/"🔄 Thay mẫu" bị khoá cứng, bấm lại sau đó KHÔNG còn phản ứng gì (đúng
// hiện tượng người dùng báo, dễ dính chỉ với 1 lần lỡ tay bấm Hủy hộp thoại). "cancel" là sự kiện chuẩn
// trên input[type=file] (mọi trình duyệt hiện đại) bắn ra đúng khi đóng hộp thoại mà KHÔNG chọn file nào.
function pickAndParseMasterListFile() {
  return new Promise((resolve) => {
    const input = document.getElementById('itPriceMasterListFileInput');
    input.value = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      input.onchange = null;
      input.oncancel = null;
      resolve(value);
    };
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return finish(null);
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await fetch('/api/it-price/master-list/parse-file', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
        finish(data);
      } catch (err) {
        alert(`⛔ ${err.message}`);
        finish(null);
      }
    };
    input.oncancel = () => finish(null);
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
  const marginColumnKey = await pickMarginColumnKey(parsed.columns);

  const entry = {
    id: Date.now(), name: name.trim(),
    fileUrl: parsed.fileUrl, fileName: parsed.fileName, columns: parsed.columns, marginColumnKey,
    // Gắn đúng kênh đang mở lúc tạo (mục 1 kế hoạch) — trước đây KHÔNG có field này nên 1 mẫu bị dùng
    // chung/xoá nhầm giữa Bán Lẻ và Bán Buôn.
    priceType: activeItPriceSubTab,
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
  // Dropdown "Mẫu Giá Phê Duyệt" ở form tạo đề xuất (renderItPriceMasterListSelect()) TRƯỚC ĐÂY không
  // được vẽ lại ở đây — mẫu VỪA thêm không hiện ngay cho người đề xuất (kể cả khi họ vừa là admin), phải
  // đổi sub-tab/tải lại trang mới thấy. deleteItPriceMasterList() bên dưới đã làm đúng (gọi cả 2 hàm),
  // add/replace/rename lại thiếu — bổ sung cho nhất quán.
  renderItPriceMasterListSelect();
}

async function replaceItPriceMasterListFile(id) {
  const list = (DB.itPriceMasterLists || []).find(m => m.id === id);
  if (!list) return;
  if (!confirm(`Thay mẫu mới cho "${list.name}"? Khuôn cột hiện tại (${itPriceColumnListText(list.columns)}) sẽ bị THAY THẾ hoàn toàn.`)) return;
  const parsed = await pickAndParseMasterListFile();
  if (!parsed) return;
  // Khuôn cột đổi hẳn -> cột Margin/Chiết Khấu gán trước đó (nếu có) hoàn toàn có thể không còn đúng vị
  // trí/tên -> luôn hỏi lại từ đầu (không tự giữ marginColumnKey cũ).
  const marginColumnKey = await pickMarginColumnKey(parsed.columns);

  const snapshot = [...(DB.itPriceMasterLists || [])];
  DB.itPriceMasterLists = snapshot.map(m => m.id === id ? {
    ...m, fileUrl: parsed.fileUrl, fileName: parsed.fileName, columns: parsed.columns, marginColumnKey,
    uploadedBy: currentUser.username, uploadedByName: currentUser.name, uploadedAt: new Date().toLocaleString('vi-VN')
  } : m);
  const saved = await syncStorage('itPriceMasterLists');
  if (!saved) { DB.itPriceMasterLists = snapshot; return; }
  logSystemAction('IT_SUPPORT', 'REPLACE_IT_PRICE_MASTER_LIST', `Thay mẫu Mẫu Giá "${list.name}" (${parsed.columns.length} cột)`, 'SUCCESS');
  alert(`✅ Đã cập nhật "${list.name}" (${parsed.columns.length} cột).`);
  renderItPriceMasterListAdmin();
  renderItPriceMasterListSelect(); // Xem chú thích ở addItPriceMasterList() — cùng lỗi thiếu vẽ lại dropdown.
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
  renderItPriceMasterListSelect(); // Xem chú thích ở addItPriceMasterList() — cùng lỗi thiếu vẽ lại dropdown.
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
  // Mirror đúng bộ lọc priceType ở renderItPriceMasterListAdmin() — người đề xuất chỉ chọn được mẫu
  // đúng kênh mình đang nộp (hoặc mẫu cũ chưa gắn kênh).
  const lists = (DB.itPriceMasterLists || []).filter(m => !m.priceType || m.priceType === activeItPriceSubTab);
  wrap.classList.toggle('hidden', lists.length === 0);
  if (!lists.length) return;
  const prevValue = select.value;
  select.innerHTML = `<option value="">-- Chọn Mẫu Giá Phê Duyệt --</option>` +
    lists.map(m => `<option value="${m.id}">${escapeHtml(m.name)} (${(m.columns || []).length} cột)</option>`).join('');
  if (lists.some(m => String(m.id) === prevValue)) select.value = prevValue;
  updateItPriceMasterListDownloadLink();
}

// Bán Buôn KHÔNG có khái niệm "Toàn bộ" — mỗi đề xuất luôn phải gắn rõ 1-nhiều siêu thị/cửa hàng cụ
// thể ("Siêu Thị Đề Xuất"), ô multi-select LUÔN hiện sẵn và LUÔN bắt buộc (xem submitItPriceApproval()/
// itPriceApprovals.extraValidate ở lib/createValidation.js). Bán Lẻ (đợt 9/2026, tách biểu mẫu theo yêu
// cầu người dùng) KHÔNG còn khái niệm này nữa — đã có "Vùng Giá Áp Dụng" đủ khoanh phạm vi, khối
// #itPriceWholesaleScopeDateWrap (gồm cả Ngày Áp Dụng/Ngày Hết Hiệu Lực) ẩn hẳn khỏi Bán Lẻ, xem
// setItPriceSubTab()/resetItPriceForm() ở dưới.
function applyItPriceStoreScopeUIForSubTab() {
  const isWholesale = activeItPriceSubTab === 'WHOLESALE';
  const wrap = document.getElementById('itPriceWholesaleScopeDateWrap');
  if (wrap) wrap.classList.toggle('hidden', !isWholesale);
  // itPriceEffectiveDate có thể mang thuộc tính HTML "required" (mặc định TRUE ở CORE_FIELD_MANIFEST.
  // IT_PRICE, admin có thể bật/tắt qua màn Biểu Mẫu) — PHẢI gỡ khi ẩn (Bán Lẻ), nếu không trình duyệt tự
  // chặn hẳn sự kiện submit (input required+ẩn không focus được) TRƯỚC KHI submitItPriceApproval() kịp
  // chạy, khiến Bán Lẻ không gửi được gì mà không rõ lý do (lỗi thật đã gặp lúc viết test click thật).
  const effDate = document.getElementById('itPriceEffectiveDate');
  if (effDate) effDate.required = isWholesale;
  if (isWholesale) {
    renderMultiSelectDropdown('itPriceStoreScopeStoresMultiSelect', DB.stores || [], getMultiSelectValues('itPriceStoreScopeStoresMultiSelect'), {
      placeholder: '🔍 Tìm siêu thị/cửa hàng để thêm...',
      emptyText: 'Chưa chọn siêu thị/cửa hàng nào.'
    });
  }
}

// "Ngày hết hiệu lực" — chọn "Khác" mới hiện ô nhập ngày thật, bắt buộc (server tự xác minh lại y hệt ở
// itPriceApprovals.extraValidate). Mặc định "Vĩnh viễn" (PERMANENT) — không nhập ngày hết hiệu lực nào.
function onItPriceExpiryModeChange() {
  const mode = document.getElementById('itPriceExpiryMode').value;
  document.getElementById('itPriceExpiryDateWrap').classList.toggle('hidden', mode !== 'OTHER');
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
  // "Đơn Vị Áp Dụng Giá Bán Buôn" — bắt buộc cho Bán Buôn, chặn sớm cho trải nghiệm mượt (server tự xác
  // minh lại y hệt ở itPriceApprovals.extraValidate, không tin giá trị client gửi).
  const wholesaleApplyUnit = document.getElementById('itPriceWholesaleApplyUnit').value.trim();
  if (activeItPriceSubTab === 'WHOLESALE' && !wholesaleApplyUnit) {
    return alert('⛔ Vui lòng nhập Đơn Vị Áp Dụng Giá Bán Buôn.');
  }
  // "Vùng Giá Áp Dụng" — CHỈ còn ở form Bán Lẻ RIÊNG của Mua Hàng (module-muahang.js, #mhItPriceRetailZone,
  // submitMhItPriceApproval() — 10/2026, đợt tách khỏi Hỗ Trợ IT). Hàm này giờ CHỈ còn chạy cho Bán Buôn
  // (Vận Hành), nên #itPriceRetailZone không còn tồn tại ở đây — optional-chain để không vỡ nếu lỡ gọi.
  const priceZone = document.getElementById('itPriceRetailZone')?.value || '';
  // "Siêu thị đề xuất"/"Ngày áp dụng"/"Ngày hết hiệu lực" — CHỈ còn áp dụng cho Bán Buôn (đợt 9/2026,
  // tách biểu mẫu theo yêu cầu người dùng: Bán Lẻ đã có "Vùng Giá Áp Dụng" đủ khoanh phạm vi, không cần
  // chọn thêm). Bán Lẻ tự gắn mặc định storeScope=ALL/ngày áp dụng=hôm nay/hết hiệu lực=Vĩnh viễn, KHÔNG
  // đọc từ input nào (3 input đó đã ẩn hẳn khỏi form Bán Lẻ — xem itSupportSection.html). Server vẫn tự
  // xác minh lại y hệt ở itPriceApprovals.extraValidate, không tin giá trị client gửi.
  const isWholesale = activeItPriceSubTab === 'WHOLESALE';
  let storeScopeMode = 'ALL', storeScopeStores = [], effectiveDate, expiryMode = 'PERMANENT', expiryDate = null;
  if (isWholesale) {
    storeScopeMode = 'OTHER';
    storeScopeStores = getMultiSelectValues('itPriceStoreScopeStoresMultiSelect');
    if (storeScopeStores.length === 0) {
      return alert('⛔ Vui lòng chọn ít nhất 1 siêu thị/cửa hàng đề xuất.');
    }
    effectiveDate = document.getElementById('itPriceEffectiveDate').value;
    if (!effectiveDate) return alert('⛔ Vui lòng chọn Ngày Áp Dụng.');
    expiryMode = document.getElementById('itPriceExpiryMode').value === 'OTHER' ? 'OTHER' : 'PERMANENT';
    expiryDate = expiryMode === 'OTHER' ? document.getElementById('itPriceExpiryDate').value : null;
    if (expiryMode === 'OTHER') {
      if (!expiryDate) return alert('⛔ Vui lòng chọn Ngày Hết Hiệu Lực (hoặc chọn lại "Vĩnh viễn").');
      if (expiryDate < effectiveDate) return alert('⛔ Ngày Hết Hiệu Lực phải từ Ngày Áp Dụng trở đi.');
    }
  } else {
    effectiveDate = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD theo múi giờ máy chủ, khớp DATE_RE server.
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
  let customData;
  try {
    customData = await collectDynamicFieldsData(itPriceDynamicModKey());
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const payload = {
    code,
    // Tự động gắn đúng priceType theo sub-tab con đang mở (KHÔNG có dropdown chọn tay — mục 1 kế
    // hoạch) — server tự xác minh lại giá trị hợp lệ ở itPriceApprovals.extraValidate.
    priceType: activeItPriceSubTab,
    priceTier: activeItPriceSubTab === 'WHOLESALE' ? document.getElementById('itPriceTier').value : null,
    wholesaleApplyUnit: activeItPriceSubTab === 'WHOLESALE' ? wholesaleApplyUnit : null,
    priceZone: activeItPriceSubTab === 'RETAIL' && priceZone ? priceZone : null,
    masterListId: masterListId ? Number(masterListId) : null,
    files: [{
      fileUrl: itPricePendingFile.fileUrl, fileName: itPricePendingFile.fileName,
      items: itPricePendingFile.items, columnLabels: itPricePendingFile.columnLabels
    }],
    extraFiles,
    reason: document.getElementById('itPriceReason').value.trim(),
    storeScope: { mode: storeScopeMode, stores: storeScopeStores },
    effectiveDate,
    expiryMode,
    expiryDate,
    createdAt: new Date().toLocaleString('vi-VN'),
    customData
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
  const firstStepApprovers = resolveEffectiveStepApprovers(wfConfig, 1);
  if (firstStepApprovers.length) {
    notifyUsersByEmail('IT_SUPPORT', 'NOTIFY_APPROVAL_NEEDED', code, firstStepApprovers,
      `[VPDT] Đề xuất duyệt giá ${code} cần bạn phê duyệt`,
      `Đề xuất duyệt giá (${code}) do ${currentUser.name} đề xuất đang chờ bạn phê duyệt.`);
  }
  alert('✅ Đã gửi đề xuất duyệt giá thành công!');

  resetItPriceForm();
  renderItPriceApprovals();
}

// Xem trước quy trình duyệt giá — 1 nút dùng chung cho cả 2 sub-tab con vì 2 nhánh tra cứu khác hẳn
// nhau: Bán Lẻ theo PHÒNG BAN đề xuất, Bán Buôn theo MỨC Margin/Chiết Khấu (xem 2 hàm resolve* ở
// core.js, cùng nhánh submitItPriceApproval() dùng).
function previewItPriceWorkflow() {
  if (activeItPriceSubTab === 'WHOLESALE') {
    const tier = document.getElementById('itPriceTier').value;
    if (!tier) return alert('Vui lòng chọn Mức Margin / Chiết Khấu trước khi xem quy trình!');
    return openGenericWorkflowPreviewModal(
      '🔍 Xem Trước Quy Trình Phê Duyệt Giá Bán Buôn',
      `Mức áp dụng: ${itPriceTierLabel(tier)}`,
      resolveItPriceTierWorkflowConfigClient(tier),
      `Mức "${itPriceTierLabel(tier)}" chưa được cấu hình quy trình phê duyệt giá Bán Buôn.`
    );
  }
  const dept = document.getElementById('itPriceDeptDisplay').value;
  if (!dept) return alert('Tài khoản của bạn chưa được gán phòng ban nên chưa xác định được quy trình phê duyệt!');
  openGenericWorkflowPreviewModal(
    '🔍 Xem Trước Quy Trình Phê Duyệt Giá Bán Lẻ',
    `Phòng ban: ${dept}`,
    resolveItPriceDeptWorkflowConfigClient(dept, 'RETAIL'),
    `Phòng ban "${dept}" chưa được cấu hình quy trình phê duyệt giá Bán Lẻ.`
  );
}

// resetItPriceForm() — nút "↺ Làm Mới" (khớp mẫu resetXxxForm dùng chung, xem CLAUDE.md/core.js
// confirmAndResetForm()) VÀ tái dùng lại cho đúng phần dọn form sau khi gửi đề xuất thành công ở trên
// (KHÔNG duplicate) — form.reset() gốc không tự sinh lại mã mới/tự set Phòng Ban/không tự xoá chip file
// đơn+nhiều nên cần dọn thêm. LƯU Ý mức Margin/Chiết Khấu (itPriceTier, chỉ áp dụng Bán Buôn): "Làm Mới"
// CHỈ xoá giá trị đã chọn của trường này về rỗng — KHÔNG tự chuyển sub-tab con Bán Lẻ/Bán Buôn
// (activeItPriceSubTab) về mặc định, vì đó là trạng thái hiển thị CHUNG của cả danh sách đề xuất bên
// dưới (setItPriceSubTab() tự lọc lại danh sách theo priceType), đổi ngầm khi bấm "Làm Mới" form sẽ gây
// bất ngờ khó hiểu hơn là có ích. itPriceTierSelectWrap vẫn tự ẩn/hiện đúng theo sub-tab đang mở như cũ.
function resetItPriceForm() {
  const formEl = document.getElementById('itPriceCreateForm');
  if (!formEl) return;
  formEl.reset();
  itPricePendingFile = null;
  document.getElementById('itPriceFileStatus').innerText = '';
  document.getElementById('itPriceFilePreviewWrap').classList.add('hidden');
  document.getElementById('itPriceCode').value = generateItPriceCode();
  document.getElementById('itPriceDeptDisplay').value = currentUser.dept;
  document.getElementById('itPriceTier').value = '';
  document.getElementById('itPriceWholesaleApplyUnit').value = '';
  // #itPriceRetailZone không còn tồn tại ở đây (chỉ Bán Buôn, xem chú thích ở submitItPriceApproval()).
  const retailZoneEl = document.getElementById('itPriceRetailZone');
  if (retailZoneEl) retailZoneEl.value = '';
  renderItPriceMasterListSelect();
  clearSingleFileInput('itPriceFileInput', 'itPriceFileChip');
  clearMultiFileInput('itPriceExtraFiles', 'itPriceExtraFilesChip');
  // "Ngày hết hiệu lực" — form.reset() ở trên đã tự đưa <select> về lại giá trị mặc định (PERMANENT),
  // chỉ cần xoá lựa chọn multi-select đã chọn trước đó rồi gọi lại applyItPriceStoreScopeUIForSubTab()
  // để hiện/ẩn ĐÚNG khối Bán Buôn theo sub-tab con đang mở (form.reset() không đụng gì tới class "hidden").
  document.getElementById('itPriceExpiryDateWrap').classList.add('hidden');
  renderMultiSelectDropdown('itPriceStoreScopeStoresMultiSelect', DB.stores || [], [], {
    placeholder: '🔍 Tìm siêu thị/cửa hàng để thêm...',
    emptyText: 'Chưa chọn siêu thị/cửa hàng nào.'
  });
  applyItPriceStoreScopeUIForSubTab();
  checkItPriceMarginConsistency(); // itPricePendingFile vừa về null + itPriceTier vừa trắng -> tự ẩn cảnh báo cũ.
}

// ===== Danh Mục "Vùng Giá Áp Dụng" (DB.priceZones) — Hỗ Trợ IT > Phê Duyệt Giá, sub-tab Bán Lẻ, ô
// #itPriceRetailZone. Danh sách phẳng thuần, mirror DB.carTaxiCompanies/DB.stores (không cần key ổn
// định — tên vùng chính là giá trị lưu thẳng vào itPriceApprovals.priceZone). =====
async function savePriceZone(e) {
  e.preventDefault();
  const name = document.getElementById('txtPriceZoneName').value.trim();
  if (!name) return;
  if (DB.priceZones.includes(name)) return alert('Vùng giá đã tồn tại!');
  DB.priceZones.push(name);
  const saved = await syncStorage('priceZones');
  if (!saved) { DB.priceZones = DB.priceZones.filter(x => x !== name); return; }
  logSystemAction('USER_MGM', 'ADD_PRICE_ZONE', `Thêm vùng giá áp dụng mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtPriceZoneName').value = '';
  renderPriceZoneList();
  populateDropdowns();
}

async function deletePriceZone(name) {
  if (!confirm(`Xóa vùng giá "${name}"?`)) return;
  const prevList = [...DB.priceZones];
  DB.priceZones = DB.priceZones.filter(x => x !== name);
  const saved = await syncStorage('priceZones');
  if (!saved) { DB.priceZones = prevList; renderPriceZoneList(); return; }
  logSystemAction('USER_MGM', 'DELETE_PRICE_ZONE', `Xóa vùng giá áp dụng [${name}]`, 'SUCCESS', name);
  renderPriceZoneList();
  populateDropdowns();
}

function renderPriceZoneList() {
  const ul = document.getElementById('priceZoneList');
  if (!ul) return;
  ul.innerHTML = (DB.priceZones || []).map(name => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      <span class="flex-1">${escapeHtml(name)}</span>
      <button data-op="renamePriceZone" data-arg0="${escapeHtml(name)}" class="text-blue-600 font-bold hover:underline whitespace-nowrap">✏️ Sửa</button>
      <button data-op="deletePriceZone" data-arg0="${escapeHtml(name)}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}
async function renamePriceZone(name) {
  const ok = await renameCatalogEntryClient('priceZones', name, 'Danh Mục Vùng Giá Áp Dụng');
  if (ok) { renderPriceZoneList(); populateDropdowns(); }
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
// Điểm vào form "Phê Duyệt Giá Bán Buôn" ở module Vận Hành (10/2026) — gọi từ setVanHanhSubTab('ITPRICE').
// Khoá cứng WHOLESALE (không có switcher ở đây) + khởi tạo các field mà setItPriceSubTab() không tự làm
// (mã tự sinh/phòng ban hiển thị — trước đây do setItSupportSubTab('PRICE') đảm nhiệm, xem chú thích ở
// hàm đó, nay chỉ chạy ở đây vì form đã chuyển khỏi Hỗ Trợ IT).
function enterVanHanhItPriceForm() {
  setItPriceSubTab('WHOLESALE');
  const codeEl = document.getElementById('itPriceCode');
  if (codeEl) codeEl.value = generateItPriceCode();
  const deptEl = document.getElementById('itPriceDeptDisplay');
  if (deptEl) deptEl.value = currentUser.dept;
  // renderVanHanhItPriceList() — danh sách đề xuất Bán Buôn CỦA TÔI/tôi cần duyệt, hiện NGAY tại đây
  // (10/2026, yêu cầu người dùng) — gọi lại mỗi lần vào tab để chắc chắn khớp dữ liệu mới nhất.
  renderVanHanhItPriceList();
}

let activeItPriceSubTab = 'RETAIL';
// setItPriceSubTab() giờ dùng CHUNG cho 2 bối cảnh khác hẳn nhau (10/2026, đợt tách Phê Duyệt Giá khỏi
// Hỗ Trợ IT — xem chú thích đầu itSupportSection.html):
//  1. Hỗ Trợ IT (nút btnItPriceSubRetail/btnItPriceSubWholesale, itSupportSection.html) — CHỈ lọc lại
//     danh sách theo priceType, KHÔNG còn form tạo nào ở đó nữa.
//  2. module-vanhanh.js — khoá cứng 'WHOLESALE' lúc vào tab, có form tạo (#itPriceCreateForm, ids GIỮ
//     NGUYÊN, chỉ chuyển sang sống trong vanHanhSection.html).
// Toàn bộ lookup DOM liên quan tới FORM (tierWrap/applyUnitWrap/retailZoneWrap/itPriceCreateForm/
// itPriceNoCreatePermNote/Mẫu Giá select) đều PHẢI có null-guard vì các id này không tồn tại khi hàm
// chạy từ bối cảnh (1) — bỏ sót 1 chỗ sẽ vỡ luôn nút lọc Bán Lẻ/Bán Buôn ở Hỗ Trợ IT.
function setItPriceSubTab(subTab) {
  activeItPriceSubTab = subTab === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL';
  // Mục B: trường Mức Margin/Chiết Khấu chỉ hiện + bắt buộc khi đang ở sub-tab Bán Buôn.
  const tierWrap = document.getElementById('itPriceTierSelectWrap');
  if (tierWrap) tierWrap.classList.toggle('hidden', activeItPriceSubTab !== 'WHOLESALE');
  // "Đơn Vị Áp Dụng Giá Bán Buôn" — cùng điều kiện hiện/ẩn với tierWrap ở trên (chỉ Bán Buôn).
  const applyUnitWrap = document.getElementById('itPriceWholesaleApplyUnitWrap');
  if (applyUnitWrap) applyUnitWrap.classList.toggle('hidden', activeItPriceSubTab !== 'WHOLESALE');
  // "Vùng Giá Áp Dụng" — đối xứng applyUnitWrap ở trên, chỉ hiện + bắt buộc khi Bán Lẻ. Từ 10/2026 field
  // này chỉ còn tồn tại trong form Bán Lẻ CỦA MUA HÀNG (id riêng #mhItPriceRetailZone, xem module-muahang.js)
  // — id CŨ #itPriceRetailZoneWrap không còn ở đâu cả, nhánh này giờ luôn no-op nhưng giữ lại để hàm vẫn
  // đúng ngữ nghĩa nếu sau này Vận Hành cũng cần hiện field tương tự.
  const retailZoneWrap = document.getElementById('itPriceRetailZoneWrap');
  if (retailZoneWrap) retailZoneWrap.classList.toggle('hidden', activeItPriceSubTab !== 'RETAIL');
  const createForm = document.getElementById('itPriceCreateForm');
  if (createForm) {
    applyItPriceStoreScopeUIForSubTab();
    checkItPriceMarginConsistency(); // rời khỏi Bán Buôn -> tự ẩn cảnh báo (hàm tự kiểm tra activeItPriceSubTab).
    // "Trường Bổ Sung" giờ khác nhau giữa Bán Lẻ/Bán Buôn (2 modKey riêng, xem itPriceDynamicModKey()) —
    // phải vẽ lại đúng bộ field của sub-tab vừa chuyển tới, không còn dùng chung 1 bộ như trước.
    renderDynamicInputsForModule(itPriceDynamicModKey(), 'dynamicFieldsContainer_IT_PRICE');
    // Quyền đề xuất giờ tách riêng theo priceType (itPriceProposeCreateWholesale/Retail, 10/2026) — một
    // người có thể chỉ được đề xuất 1 trong 2 loại, nên form tạo phải ẩn/hiện lại MỖI LẦN đổi sub-tab,
    // không chỉ 1 lần lúc vào tab PRICE như trước (lúc đó còn dùng chung 1 flag).
    const canCreateSub = canProposeItPriceType(currentUser, activeItPriceSubTab);
    createForm.classList.toggle('hidden', !canCreateSub);
    const noPermNote = document.getElementById('itPriceNoCreatePermNote');
    if (noPermNote) noPermNote.classList.toggle('hidden', canCreateSub);
    renderItPriceMasterListSelect();
  }
  resetListPage('itPrice');
  renderItPriceApprovals();
  // Mẫu Giá giờ lọc theo priceType (mục 1 kế hoạch) -> phải vẽ lại panel quản trị + dropdown chọn mẫu
  // mỗi lần đổi kênh, không chỉ 1 lần lúc vào tab PRICE như trước. Panel quản trị (#itPriceMasterListAdminWrap)
  // vẫn sống ở Hỗ Trợ IT, không cần null-guard thêm vì renderItPriceMasterListAdmin() tự guard.
  if (currentUser.perms?.admin) renderItPriceMasterListAdmin();
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

// Phạm vi Xem: admin/itPriceSupport (đội hỗ trợ giá, 10/2026 tách khỏi itManage) xem hết, người đề
// xuất xem đề xuất của mình, người duyệt xem hồ sơ nằm trong luồng duyệt của họ — không có quyền
// "Xem" riêng như carView/docView vì module này chưa cần phân biệt xem-rộng theo phòng ban.
function canViewItPriceApproval(user, p) {
  if (user.perms?.admin || user.perms?.itPriceSupport) return true;
  if (p.creator === user.username) return true;
  // Người có quyền itPriceEmergencyRejectApprove(Wholesale/Retail) đúng priceType nhưng không phải
  // người duyệt phòng ban vẫn cần xem được hồ sơ đang có yêu cầu "Từ chối khẩn cấp" chờ họ xét (hoặc
  // đã tự mình quyết định trước đó) — khớp canViewItPriceApproval() ở lib/recordViewScope.js.
  const emergencyPerm = p.priceType === 'WHOLESALE' ? user.perms?.itPriceEmergencyRejectApproveWholesale : user.perms?.itPriceEmergencyRejectApproveRetail;
  if (emergencyPerm && (p.emergencyRejectStatus === 'PENDING' || p.emergencyRejectDecidedBy === user.username)) {
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
  const currentStepApprovers = resolveEffectiveStepApprovers(wfConfig, p.currentStep);
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

// buildItPriceRowHtml(p) — 1 dòng <tr> dùng CHUNG cho cả 3 màn hiện danh sách Phê Duyệt Giá (Hỗ Trợ
// IT xử lý CẢ 2 loại + Mua Hàng chỉ Bán Lẻ + Vận Hành chỉ Bán Buôn — xem renderMhItPriceList()/
// renderVanHanhItPriceList() ngay dưới) — tách riêng khỏi renderItPriceApprovals() (10/2026, yêu cầu
// người dùng: "đơn phê duyệt vẫn phải hiện NGAY tại 2 tab Mua Hàng/Vận Hành đã tạo ra nó, không chỉ ở
// Hỗ Trợ IT") để 3 nơi luôn hiện ĐÚNG 1 khuôn cột/badge, sửa 1 chỗ áp dụng cả 3. Nút "Chi tiết" luôn mở
// ĐÚNG 1 modal chung (openItPriceModal(), renderItPriceModalControls()) — ai xem cũng thấy đủ thông tin,
// nhưng CHỈ người có quyền tương ứng (duyệt đúng bước/itPriceSupport) mới thấy nút hành động thật trong
// modal đó, nên tái dùng an toàn ở cả màn chỉ-xem (Mua Hàng/Vận Hành) lẫn màn xử lý (Hỗ Trợ IT).
//
// context ('APPROVAL' | 'SUPPORT') — yêu cầu người dùng (đợt sau, làm rõ thêm): Duyệt/Từ chối/Yêu Cầu
// Bổ Sung/Từ Chối Khẩn Cấp là việc của NGƯỜI DUYỆT, chỉ làm tại 2 tab Mua Hàng (Bán Lẻ)/Vận Hành (Bán
// Buôn) — 'APPROVAL'. Hỗ Trợ IT CHỈ còn đúng vai trò hỗ trợ/áp giá (Tôi Đang Xử Lý/Xác Nhận Đã Áp Giá/
// Huỷ Nhận Xử Lý) — 'SUPPORT'. Modal vẫn dùng CHUNG 1 cái (renderItPriceModalControls() đọc
// currentItPriceModalContext để ẩn/hiện đúng nhóm nút theo context truyền vào lúc mở, xem
// openItPriceModal()) — KHÔNG phải 2 modal riêng.
function buildItPriceRowHtml(p, context) {
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
        <button data-op="openItPriceModal" data-arg0="${p.id}" data-arg1="${escapeHtml(context)}" class="px-2.5 py-1 bg-sky-600 text-white rounded text-xs hover:opacity-90 font-bold">👁️ Chi tiết</button>
      </td>
    </tr>
  `;
}

// renderMhItPriceList()/renderVanHanhItPriceList() — danh sách "đơn của tôi/đơn tôi cần duyệt" đúng
// kênh (RETAIL ở Mua Hàng, WHOLESALE ở Vận Hành), khớp phạm vi canViewItPriceApproval() y hệt Hỗ Trợ
// IT — KHÔNG có filter bar (giữ gọn, khác Hỗ Trợ IT vốn cần lọc sâu để xử lý số lượng lớn từ CẢ 2
// kênh); sắp mới nhất lên đầu vì đây là danh sách "theo dõi phiếu của mình", không phải hàng đợi xử lý.
function renderMhItPriceList() {
  const tbody = document.getElementById('mhItPriceTableBody');
  if (!tbody) return;
  const visible = DB.itPriceApprovals
    .filter(p => (p.priceType || 'RETAIL') === 'RETAIL' && canViewItPriceApproval(currentUser, p))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  document.getElementById('paginationContainer_mhItPrice').innerHTML = buildPaginationBoxHTML('mhItPrice', 'renderMhItPriceList');
  const page = paginateList('mhItPrice', visible, 'renderMhItPriceList', 'đề xuất');
  // context='APPROVAL' — Duyệt/Từ chối/Yêu Cầu Bổ Sung/Từ Chối Khẩn Cấp làm NGAY tại đây (Mua Hàng),
  // KHÔNG phải ở Hỗ Trợ IT (xem renderItPriceModalControls()).
  tbody.innerHTML = page.length
    ? page.map(p => buildItPriceRowHtml(p, 'APPROVAL')).join('')
    : `<tr><td colspan="6" class="text-center p-6 text-gray-500 italic">Chưa có đề xuất nào.</td></tr>`;
}
function renderVanHanhItPriceList() {
  const tbody = document.getElementById('vanHanhItPriceTableBody');
  if (!tbody) return;
  const visible = DB.itPriceApprovals
    .filter(p => p.priceType === 'WHOLESALE' && canViewItPriceApproval(currentUser, p))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  document.getElementById('paginationContainer_vanHanhItPrice').innerHTML = buildPaginationBoxHTML('vanHanhItPrice', 'renderVanHanhItPriceList');
  const page = paginateList('vanHanhItPrice', visible, 'renderVanHanhItPriceList', 'đề xuất');
  // context='APPROVAL' — cùng lý do renderMhItPriceList() ở trên, áp dụng cho Vận Hành.
  tbody.innerHTML = page.length
    ? page.map(p => buildItPriceRowHtml(p, 'APPROVAL')).join('')
    : `<tr><td colspan="6" class="text-center p-6 text-gray-500 italic">Chưa có đề xuất nào.</td></tr>`;
}

function renderItPriceApprovals() {
  const tbody = document.getElementById('itPriceTableBody');
  // renderMhItPriceList()/renderVanHanhItPriceList() PHẢI luôn đồng bộ theo renderItPriceApprovals()
  // (18 nơi gọi rải khắp file này — submit/duyệt/từ chối/áp giá/xoá...) — gọi CẢ 2 ngay tại đây thay vì
  // sửa từng nơi gọi, 2 hàm đó tự "if (!tbody) return;" nên an toàn dù đang KHÔNG đứng ở tab tương ứng.
  renderMhItPriceList();
  renderVanHanhItPriceList();
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

  // context='SUPPORT' — Hỗ Trợ IT CHỈ còn nút hỗ trợ/áp giá (Tôi Đang Xử Lý/Xác Nhận Đã Áp Giá/Huỷ Nhận
  // Xử Lý), KHÔNG còn Duyệt/Từ chối/Yêu Cầu Bổ Sung/Từ Chối Khẩn Cấp (đã chuyển sang 2 tab Mua Hàng/Vận
  // Hành, xem renderMhItPriceList()/renderVanHanhItPriceList()).
  tbody.innerHTML = page.map(p => buildItPriceRowHtml(p, 'SUPPORT')).join('');
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

// Hiển thị "Siêu thị áp dụng" ở modal chi tiết đề xuất — CHỈ mang tính thông tin cho đội Hỗ Trợ IT (đã
// xác nhận với người dùng), không có logic giới hạn xem gì đi kèm.
function itPriceStoreScopeLabel(storeScope) {
  if (!storeScope || storeScope.mode !== 'OTHER') return 'Toàn bộ siêu thị, cửa hàng';
  const stores = storeScope.stores || [];
  return stores.length ? escapeHtml(stores.join(', ')) : '<span class="text-gray-400">—</span>';
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
// currentItPriceModalContext ('APPROVAL' | 'SUPPORT') — ghi nhớ NÚT nào mở modal (xem
// buildItPriceRowHtml()) để renderItPriceModalControls() ẩn/hiện đúng nhóm nút: Duyệt/Từ chối/Yêu Cầu
// Bổ Sung/Từ Chối Khẩn Cấp CHỈ hiện khi context='APPROVAL' (mở từ Mua Hàng/Vận Hành); nút hỗ trợ/áp giá
// CHỈ hiện khi context='SUPPORT' (mở từ Hỗ Trợ IT). Mặc định 'SUPPORT' cho nơi gọi cũ không truyền
// (an toàn — KHÔNG lộ nhầm nút Duyệt/Từ chối nếu có chỗ nào quên truyền).
let currentItPriceModalContext = 'SUPPORT';

function openItPriceModal(id, context) {
  currentItPriceModalId = id;
  currentItPriceModalContext = context === 'APPROVAL' ? 'APPROVAL' : 'SUPPORT';
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
    ${p.priceType === 'WHOLESALE' ? `<div><b>🏢 Đơn vị áp dụng giá bán buôn:</b> ${p.wholesaleApplyUnit ? escapeHtml(p.wholesaleApplyUnit) : '<span class="text-gray-400">—</span>'}</div>` : ''}
    ${p.masterListName ? `<div><b>Mẫu Giá áp dụng:</b> ${escapeHtml(p.masterListName)}${itPriceMasterListDownloadLinkHTML(p.masterListId)}</div>` : ''}
    <div><b>Lý do điều chỉnh:</b> ${p.reason ? escapeHtml(p.reason) : '<span class="text-gray-400">—</span>'}</div>
    <div><b>🏬 ${p.priceType === 'WHOLESALE' ? 'Siêu thị đề xuất' : 'Siêu thị áp dụng'}:</b> ${itPriceStoreScopeLabel(p.storeScope)}</div>
    <div><b>📅 Ngày áp dụng:</b> ${p.effectiveDate ? escapeHtml(p.effectiveDate) : '<span class="text-gray-400">—</span>'} <b class="ml-2">⏳ Hết hiệu lực:</b> ${p.expiryMode === 'OTHER' && p.expiryDate ? escapeHtml(p.expiryDate) : 'Vĩnh viễn'}</div>
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
  const currentStepApprovers = resolveEffectiveStepApprovers(wfConfig, p.currentStep);
  const canApprove = p.status === 'PENDING' && canApproveStep(currentUser, currentStepApprovers, p.history, p.currentStep);
  const emergencyPending = p.emergencyRejectStatus === 'PENDING';
  const canApply = p.status === 'APPROVED' && !p.applied && canSupportItPriceClient(currentUser);
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

  // Duyệt/Từ chối/Yêu Cầu Bổ Sung/Từ Chối Khẩn CHỈ thao tác được tại 2 tab Phê Duyệt Giá (Mua Hàng/Vận
  // Hành, context='APPROVAL') — Hỗ Trợ IT (context='SUPPORT') chỉ còn xem thông tin + nút hỗ trợ/áp giá,
  // theo đúng yêu cầu nghiệp vụ: "Phê duyệt/từ chối/bổ sung/phê duyệt khẩn cấp làm tại 2 tab phê duyệt
  // giá. Riêng IT sẽ là các nút còn lại như hỗ trợ và áp giá thôi".
  const isApprovalContext = currentItPriceModalContext === 'APPROVAL';

  // Người có quyền itPriceEmergencyRejectApprove(Wholesale/Retail) đúng priceType xét duyệt trực tiếp ngay tại đây.
  if (isApprovalContext && emergencyPending && canApproveItPriceEmergencyRejectClient(currentUser, p.priceType)) {
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
  if (isApprovalContext && p.status === 'APPROVED' && !p.applied && !emergencyPending && !p.applyClaimedBy && isFinalStepApproverOfItPriceClient(currentUser, p)) {
    html += `<div class="mt-2">
      <button type="button" data-op="requestItPriceEmergencyRejectAction" data-arg0="${p.id}" class="bg-red-700 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-red-800">🚨 Từ Chối Khẩn</button>
      <p class="text-[11px] text-gray-500 mt-1">Bạn đã duyệt hồ sơ này ở bước cuối cùng nhưng muốn dừng lại trước khi Hỗ Trợ IT áp giá thật — gửi yêu cầu cho người có quyền xét duyệt để huỷ hồ sơ.</p>
    </div>`;
  } else if (isApprovalContext && p.status === 'APPROVED' && !p.applied && !emergencyPending && p.applyClaimedBy && isFinalStepApproverOfItPriceClient(currentUser, p)) {
    html += `<div class="mt-2 text-[11px] text-gray-500 italic">🚨 Từ Chối Khẩn tạm khoá — IT (${escapeHtml(p.applyClaimedByName || p.applyClaimedBy)}) đang xử lý áp giá, chờ huỷ nhận việc hoặc hoàn tất trước.</div>`;
  }

  if (isApprovalContext && canApprove) {
    if (blocked) {
      html += `<div class="bg-amber-50 text-amber-800 p-2 rounded border border-amber-200">⏳ Đang chờ người đề xuất tải lên tệp bổ sung trước khi có thể duyệt.</div>`;
    } else {
      const wfForLabel = DB.workflows.find(w => w.id === wfConfig.workflowId) || { steps: [] };
      const approveLabel = resolveStepActionLabel(wfForLabel, p.currentStep);
      html += `<div class="flex gap-2 flex-wrap">
        <button type="button" data-op="approveItPrice" data-arg0="${p.id}" class="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-emerald-700">✅ ${escapeHtml(approveLabel)}</button>
        <button type="button" data-op="rejectItPrice" data-arg0="${p.id}" class="bg-red-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-red-700">❌ Từ chối</button>
        <button type="button" data-op="requestItPriceInfoApprover" data-arg0="${p.id}" class="bg-amber-500 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-amber-600">✉️ Yêu Cầu Bổ Sung</button>
      </div>`;
    }
  }

  // Hỗ trợ/áp giá (Tôi Đang Xử Lý/Xác Nhận Đã Áp Giá/Huỷ Nhận Xử Lý/Yêu Cầu Bổ Sung của IT) CHỈ hiện ở
  // Hỗ Trợ IT (context='SUPPORT') — đúng "IT sẽ là các nút còn lại như hỗ trợ và áp giá thôi".
  if (!isApprovalContext && canApply) {
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
  const approverUsernames = getItPriceEmergencyRejectApproverUsernames(updated.priceType);
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
  let customData;
  try {
    customData = await collectDynamicFieldsData('IT_TICKET');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const payload = {
    code,
    title: document.getElementById('itTicketTitle').value.trim(),
    category: document.getElementById('itTicketCategory').value,
    description: document.getElementById('itTicketDescription').value.trim(),
    createdAt: new Date().toLocaleString('vi-VN'),
    customData
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
  resetItTicketForm();
  renderItTickets();
}

// resetItTicketForm() — nút "↺ Làm Mới" (khớp mẫu resetXxxForm dùng chung) VÀ tái dùng lại cho đúng
// phần dọn form sau khi gửi thành công ở trên (KHÔNG duplicate) — form.reset() gốc không tự sinh lại mã
// yêu cầu mới nên cần dọn thêm đúng 1 dòng.
function resetItTicketForm() {
  const formEl = document.getElementById('itTicketCreateForm');
  if (!formEl) return;
  formEl.reset();
  document.getElementById('itTicketCode').value = generateItTicketCode();
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
      <td class="border p-2 space-y-1">
        <div>${IT_TICKET_STATUS_BADGES[t.status] || escapeHtml(t.status)}</div>
        ${t.approvalStatus ? `<div>${IT_TICKET_APPROVAL_BADGES[t.approvalStatus] ? IT_TICKET_APPROVAL_BADGES[t.approvalStatus](t) : escapeHtml(t.approvalStatus)}</div>` : ''}
      </td>
      <td class="border p-2 text-xs">${t.assigneeName ? escapeHtml(t.assigneeName) : '<span class="text-gray-400 italic">Chưa nhận</span>'}</td>
      <td class="border p-2 text-center space-x-1">
        ${(() => {
          const primaryBtnHTML = `<button data-op="runItTicketAction" data-arg0="${t.id}" data-arg1="view" class="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs hover:opacity-90 font-bold">👁️ Xem / Xử lý</button>`;
          const secondaryOptions = [];
          // "Gửi Phê Duyệt" ngay ở nút thao tác (yêu cầu người dùng) — mirror ĐÚNG điều kiện hiện nút
          // "📨 Gửi/Gửi Lại Yêu Cầu Phê Duyệt" bên trong modal (renderItTicketModal()): chỉ đội IT
          // (canManageItSupportClient), ticket CHƯA kết thúc (TODO hoặc DOING — lần sửa lỗi 2: TRƯỚC ĐÂY
          // chỉ cho DOING, tức phải nhận việc rồi mới gửi được, sai với nghiệp vụ "xin phê duyệt TRƯỚC khi
          // bắt đầu xử lý" — xem escalateItTicket() ở lib/recordActions.js), và KHÔNG đang có 1 yêu cầu
          // phê duyệt nào chờ xử lý (approvalStatus PENDING — REJECTED vẫn cho gửi LẠI). Bấm vào mở thẳng
          // modal + hiện luôn form gửi phê duyệt (openItTicketEscalateForm()), không phải tự tìm nút bên trong.
          if (canManageItSupportClient(currentUser) && (t.status === 'TODO' || t.status === 'DOING') && t.approvalStatus !== 'PENDING') {
            secondaryOptions.push({ value: 'escalate', label: t.approvalStatus === 'REJECTED' ? '📨 Gửi Lại Phê Duyệt' : '📨 Gửi Phê Duyệt' });
          }
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
    // "Gửi Phê Duyệt" từ nút thao tác — mở thẳng modal + hiện luôn form gửi phê duyệt, giữ ĐÚNG 1 nguồn
    // duy nhất cho form này (renderItTicketModal()), không dựng lại 1 bản UI riêng ở đây.
    case 'escalate': openItTicketModal(id); openItTicketEscalateForm(); break;
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

  // "🎯 Nhận Xử Lý" — CHẶN khi đang chờ/bị từ chối phê duyệt (lần sửa lỗi 2: giờ có thể xin phê duyệt
  // NGAY từ lúc TODO, xem khối "📨 Gửi Yêu Cầu Phê Duyệt" bên dưới — mirror ĐÚNG chặn server ở
  // claimItTicket(), đây chỉ là UI phản ánh đúng trạng thái).
  if (canManage && t.status === 'TODO' && !awaitingApproval && !blockedByRejection) {
    controlsHTML += `<button type="button" data-op="claimItTicketAction" class="bg-sky-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-sky-700 mr-2">🎯 Nhận Xử Lý</button>`;
  }

  // "📨 Gửi Yêu Cầu Phê Duyệt" — lần sửa lỗi 2 (phản hồi người dùng): TRƯỚC ĐÂY chỉ hiện khi ticket đã
  // DOING (tức phải "🎯 Nhận Xử Lý" trước), khiến IT không có cách nào xin phê duyệt TRƯỚC khi bắt đầu xử
  // lý — sai với đúng nghiệp vụ (xin ý kiến quản lý TRƯỚC KHI làm tiếp, không phải sau khi đã nhận việc).
  // Nới sang cả TODO (chưa nhận việc) lẫn DOING (đã nhận, giữ nguyên hành vi cũ) — mirror ĐÚNG điều kiện
  // server ở escalateItTicket() (lib/recordActions.js).
  if (canManage && (t.status === 'TODO' || t.status === 'DOING')) {
    if (awaitingApproval) {
      controlsHTML += `<div class="bg-amber-50 text-amber-800 text-xs p-2 rounded border border-amber-200 mb-2">⏳ Đang chờ <b>${escapeHtml(t.approvalApproverName)}</b> phê duyệt trước khi ${t.status === 'TODO' ? 'nhận việc/' : ''}tiếp tục xử lý.<br>Lý do đã gửi: "${escapeHtml(t.approvalReason)}"</div>`;
    } else {
      if (blockedByRejection) {
        controlsHTML += `<div class="bg-red-50 text-red-700 text-xs p-2 rounded border border-red-200 mb-2">❌ <b>${escapeHtml(t.approvalApproverName)}</b> đã từ chối yêu cầu phê duyệt${t.approvalComment ? `: "${escapeHtml(t.approvalComment)}"` : '.'}<br>Gửi lại yêu cầu tới người khác hoặc hủy yêu cầu hỗ trợ này.</div>`;
      }
      if (!showItTicketEscalateForm) {
        controlsHTML += `<button type="button" data-op="openItTicketEscalateForm" class="bg-gray-200 text-gray-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-300 mb-2">📨 ${blockedByRejection ? 'Gửi Lại' : 'Gửi'} Yêu Cầu Phê Duyệt</button>`;
      } else {
        // Đổi từ <select> liệt kê toàn bộ user sang ô tìm-kiếm-gõ-chọn dùng chung (quy ước "sdd*", xem
        // CLAUDE.md) — VẪN chọn đúng 1 người (bàn giao dữ liệu server không đổi: itTicketApproverUsername
        // đọc ra 1 username duy nhất, y hệt .value của <select> cũ), chỉ đổi giao diện. Tái dùng chính
        // div#systemUsersDatalist dùng chung toàn hệ thống — nạp lại đúng lúc mở form này (loại trừ chính
        // currentUser, không thể tự gửi duyệt cho mình) qua sddSetOptions() ngay dưới đây.
        sddSetOptions('systemUsersDatalist', DB.users.filter(u => u.active !== false && u.username !== currentUser.username)
          .map(u => `${u.name} — ${u.dept || 'Chưa rõ phòng'} (${u.username})`));
        controlsHTML += `
          <div class="bg-sky-50 p-3 rounded border border-sky-200 space-y-2 mb-2">
            <h4 class="font-bold text-sky-900">📨 Gửi Yêu Cầu Phê Duyệt</h4>
            <div class="relative">
              <input type="text" id="itTicketApproverInput" data-sdd-list="systemUsersDatalist" autocomplete="off" data-op-input="resolveItTicketApproverInput" data-arg-value="0" placeholder="Gõ tên hoặc tài khoản để tìm người duyệt..." class="w-full border p-1.5 rounded bg-white text-xs">
              <input type="hidden" id="itTicketApproverUsername">
            </div>
            <textarea id="itTicketApprovalReason" placeholder="Vì sao yêu cầu này cần phê duyệt trước khi xử lý?" class="w-full border p-1.5 rounded h-16 text-xs"></textarea>
            <div class="flex gap-2">
              <button type="button" data-op="escalateItTicketAction" class="bg-sky-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-sky-700">Gửi phê duyệt</button>
              <button type="button" data-op="closeItTicketEscalateForm" class="bg-gray-300 text-gray-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-400">Huỷ</button>
            </div>
          </div>`;
      }
    }
  }

  // "🔧 Cập Nhật Xử Lý" — CHỈ khi đã nhận việc (DOING) + không đang chờ/bị từ chối phê duyệt, GIỮ NGUYÊN
  // hành vi cũ (tách khỏi khối phê duyệt ở trên vì khối đó giờ dùng chung cho cả TODO).
  if (canManage && t.status === 'DOING' && !awaitingApproval && !blockedByRejection) {
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

// Mirror resolveVsoPersonInChargeInput() (module-vanhanh.js) — tách username từ nhãn hiển thị
// "Tên — Phòng ban (username)" khi người dùng bấm chọn 1 gợi ý trong ô tìm-kiếm-gõ-chọn.
function resolveItTicketApproverInput(rawValue) {
  const m = rawValue.match(/^(.*) — .*\(([^()]+)\)$/);
  document.getElementById('itTicketApproverUsername').value = m ? m[2].trim() : '';
}

async function escalateItTicketAction() {
  if (!currentItTicketModalId) return;
  const approverUsername = document.getElementById('itTicketApproverUsername').value;
  if (!approverUsername) return alert('Vui lòng chọn đúng người duyệt từ danh sách gợi ý (gõ tên hoặc tài khoản để tìm)!');
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

