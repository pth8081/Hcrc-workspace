// ==========================================
// 1. MODULE TÀI LIỆU (DOCUMENT MODULE)
// ==========================================
// Bấm 1 thẻ dashboard Tài Liệu — set cả filterStatus lẫn filterDocType phù hợp rồi lọc lại.
function filterDocByCard(key) {
  const map = {
    __ALL__: { filterStatus: '', filterDocType: '' },
    PENDING_NEW: { filterStatus: 'PENDING', filterDocType: 'NEW' },
    PENDING_VERSION: { filterStatus: 'PENDING', filterDocType: 'VERSION' },
    APPROVED: { filterStatus: 'APPROVED', filterDocType: '' },
    REJECTED: { filterStatus: 'REJECTED', filterDocType: '' },
    DRAFT: { filterStatus: 'DRAFT', filterDocType: '' }
  };
  const box = document.querySelector('#docSection .filter-box-details');
  if (box) box.open = true;
  applyDashboardCardFilter(map[key] || {}, 'doc', renderDocs);
}

function onFilterChange() {
  resetListPage('doc');
  renderDocs();
}

// ---- Sinh Mã Tài Liệu tự động + quản lý version (Cập nhật/Nhập mới) ----

// Bỏ dấu tiếng Việt để suy ra viết tắt — đ/Đ không tách được qua NFD nên xử lý riêng.
// stripVnDiacritics() da chuyen sang core.js (Ha tang: nap module theo cum, dot 7) - sddRenderRows()
// (widget tim-kiem-go-chon dung chung cho hau het module, xem CLAUDE.md) goi thang ham nay o core.js.

// Các từ đứng đầu tên phòng ban không mang nghĩa phân biệt (Phòng/Ban/Bộ phận...) — bỏ qua khi suy ra
// viết tắt để "Phòng Công Nghệ Thông Tin" ra "CNTT" thay vì "PCNTT".
const DEPT_ABBR_STOPWORDS = new Set(['phong', 'ban', 'bo', 'phan', 'to', 'trung', 'tam', 'doi', 'khoi']);

function deriveAbbr(name, stopwords) {
  const words = stripVnDiacritics(name).split(/[\s/\-\u2013]+/).filter(w => /[a-zA-Z]/.test(w));
  const kept = stopwords ? words.filter(w => !stopwords.has(w.toLowerCase())) : words;
  const useWords = kept.length ? kept : words;
  return useWords.map(w => w[0].toUpperCase()).join('');
}

// Viết tắt Phòng ban/Phân loại — ưu tiên giá trị admin đã cấu hình (DB.deptAbbrs/DB.docCatAbbrs, xem
// màn Quản Lý Danh Mục), suy ra tự động nếu chưa có. Áp dụng ngay, không cần admin duyệt trước.
function getDeptAbbr(deptName) {
  return DB.deptAbbrs[deptName] || deriveAbbr(deptName, DEPT_ABBR_STOPWORDS);
}
function getDocCatAbbr(catName) {
  return DB.docCatAbbrs[catName] || deriveAbbr(catName, null);
}

// Số thứ tự TIẾP THEO chưa từng dùng cho prefix này, tính từ số thứ tự LỚN NHẤT từng xuất hiện trong
// các Mã Tài Liệu gốc hiện có (không phải đếm số lượng còn lại) — nếu dùng đếm số lượng, xóa 1 tài
// liệu ở giữa dãy (vd xóa 002 trong 001/002/003) sẽ khiến số kế tiếp tính ra trùng với 003 đang tồn
// tại, bị chặn nhầm là "Mã tài liệu đã tồn tại" khi tải lên. Đánh số RIÊNG theo từng cặp Phân
// loại+Phòng ban (không dùng chung 1 dãy số toàn hệ thống) để mã ngắn gọn và có ý nghĩa lâu dài hơn.
function computeNextDocSeq(prefix) {
  const existing = DB.docs.filter(d => (d.rootDocId == null) && (d.displayCode || d.code || '').startsWith(prefix));
  const maxSeq = existing.reduce((max, d) => {
    const code = d.displayCode || d.code || '';
    const n = parseInt(code.slice(prefix.length), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return maxSeq + 1;
}

// Mã Tài Liệu tự sinh cho lần "Nhập mới" = <viết tắt Phân loại>-<viết tắt Phòng ban>-<số thứ tự 3 số>.
function generateDocCode(cat, dept) {
  const prefix = `${getDocCatAbbr(cat)}-${getDeptAbbr(dept)}-`;
  const seq = computeNextDocSeq(prefix);
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

// Viết tắt Loại Pháp Lý hợp đồng — cùng mô hình getDocCatAbbr() ở trên (ưu tiên DB.contractTypeAbbrs
// admin đã cấu hình, tự suy ra nếu chưa có).
function getContractTypeAbbr(typeName) {
  return DB.contractTypeAbbrs[typeName] || deriveAbbr(typeName, null);
}

// Số thứ tự TIẾP THEO cho HỢP ĐỒNG GỐC (không tính phụ lục — isAddendum) — lấy số LỚN NHẤT từng xuất
// hiện (không phải đếm số lượng còn lại), cùng nguyên lý computeNextDocSeq() ở trên — tránh sinh trùng
// mã nếu 1 hợp đồng ở giữa dãy số đã bị xóa trước đó.
function computeNextContractSeq(prefix) {
  const existing = DB.contracts.filter(c => !c.isAddendum && (c.code || '').startsWith(prefix));
  return existing.reduce((max, c) => {
    const n = parseInt(String(c.code || '').slice(prefix.length), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0) + 1;
}

// Mã Hợp Đồng tự sinh = HCRC-<viết tắt Phòng ban>-<viết tắt Loại Pháp Lý>-<số thứ tự 3 số>.
function generateContractCode(dept, type) {
  const prefix = `HCRC-${getDeptAbbr(dept)}-${getContractTypeAbbr(type)}-`;
  const seq = computeNextContractSeq(prefix);
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

// Mã Phụ Lục Hợp Đồng = <Mã hợp đồng gốc>-PLHD<số thứ tự 2 số> — đánh số RIÊNG theo từng hợp đồng
// (không dùng chung 1 dãy số toàn hệ thống). Lấy số LỚN NHẤT từng xuất hiện (không phải đếm số lượng
// còn lại), cùng nguyên lý computeNextDocSeq() ở trên — tránh sinh trùng mã nếu 1 phụ lục ở giữa dãy
// số đã bị xóa trước đó.
function computeNextAddendumSeq(rootContractId) {
  const existing = DB.contracts.filter(c => c.isAddendum && c.rootContractId === rootContractId);
  return existing.reduce((max, c) => {
    const n = parseInt(String(c.code || '').replace(/^.*-PLHD/, ''), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0) + 1;
}
function generateAddendumCode(rootContract) {
  const seq = computeNextAddendumSeq(rootContract.id);
  return `${rootContract.code}-PLHD${String(seq).padStart(2, '0')}`;
}

// ============ MÃ TỰ SINH cho 7 module trước đây phải gõ tay: Văn Bản Trình, Đăng Ký Xe, Mua Bán/Sửa
// Chữa/Đầu Tư (dùng chung 1 form theo activeOfficeSubTab), Biên Bản Họp, Đặt Phòng Họp, Phê Duyệt Giá
// IT, Ticket Hỗ Trợ IT. Định dạng HCRC-<viết tắt module>-<ngày tạo YYYYMMDD>-<số thứ tự 3 số>, số thứ
// tự đánh RIÊNG theo từng ngày+module (không dùng chung 1 dãy số toàn hệ thống). Lấy số LỚN NHẤT từng
// xuất hiện (không phải đếm số lượng còn lại) — cùng nguyên lý computeNextDocSeq() ở trên — tránh sinh
// trùng mã nếu 1 bản ghi ở giữa dãy số đã bị admin xóa trước đó (trước đây đếm-theo-số-lượng nên xóa 1
// bản ghi giữa dãy 001/002/003 sẽ khiến bản ghi mới sinh lại đúng mã 003 đang tồn tại, bị chặn "Mã đã
// tồn tại" — đúng lỗi người dùng báo lại).
function todayCodeDatePart() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function computeNextHcrcSeq(records, prefix) {
  const existing = records.filter(r => (r.code || '').startsWith(prefix));
  return existing.reduce((max, r) => {
    const n = parseInt(String(r.code || '').slice(prefix.length), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0) + 1;
}
function generateHcrcCode(records, moduleAbbr) {
  const prefix = `HCRC-${moduleAbbr}-${todayCodeDatePart()}-`;
  const seq = computeNextHcrcSeq(records, prefix);
  return `${prefix}${String(seq).padStart(3, '0')}`;
}
function generateSubCode() { return generateHcrcCode(DB.submissions, 'VBT'); }
function generateCarCode() { return generateHcrcCode(DB.carRegs, 'DKX'); }
// Mua Bán/Sửa Chữa/Đầu Tư dùng CHUNG 1 form (activeOfficeSubTab quyết định), mỗi loại 1 viết tắt riêng.
function generateOfficeCode() {
  const abbr = activeOfficeSubTab === 'SUA_CHUA' ? 'SC' : 'MB';
  return generateHcrcCode(DB.officeReqs, abbr);
}
function generateMinutesCode() { return generateHcrcCode(DB.meetingMinutes, 'BBH'); }
function generateMeetingCode() { return generateHcrcCode(DB.meetings, 'DPH'); }
function generateItPriceCode() { return generateHcrcCode(DB.itPriceApprovals, 'ITPG'); }
function generateItTicketCode() { return generateHcrcCode(DB.itSupportTickets, 'ITHT'); }

// Số thứ tự TIẾP THEO cho Mã Quy Trình (WF<số>) — lấy số LỚN NHẤT từng xuất hiện (không phải đếm số
// lượng còn lại), cùng nguyên lý computeNextDocSeq() ở trên — tránh sinh trùng mã nếu 1 mẫu quy trình
// ở giữa dãy số đã bị xóa trước đó (vd xóa WF002 trong WF001/WF002/WF003 vẫn sinh tiếp WF004, không
// phải WF003 đang tồn tại).
function computeNextWfSeq() {
  const maxSeq = (DB.workflows || []).reduce((max, wf) => {
    const n = parseInt(String(wf.id || '').replace(/^WF/i, ''), 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return maxSeq + 1;
}
function generateWfCode() { return `WF${String(computeNextWfSeq()).padStart(3, '0')}`; }

// Gom 1 tài liệu GỐC + toàn bộ version con của nó (kể cả bản thân tài liệu gốc), sắp theo versionNumber
// tăng dần — dùng chung cho khối mở rộng ở "Danh Sách Tài Liệu" và modal "Chi Tiết Tài Liệu".
function getDocFamily(anyDocId) {
  const doc = DB.docs.find(d => d.id === anyDocId);
  if (!doc) return [];
  const rootId = doc.rootDocId == null ? doc.id : doc.rootDocId;
  return DB.docs.filter(d => d.id === rootId || d.rootDocId === rootId)
    .sort((a, b) => (a.versionNumber || 1) - (b.versionNumber || 1));
}

// Version MỚI NHẤT của 1 tài liệu (dùng để xét điều kiện được phép "Cập nhật").
function getDocFamilyLatest(anyDocId) {
  const family = getDocFamily(anyDocId);
  return family[family.length - 1];
}

// Version mới nhất đang CHẶN việc tạo thêm version khác chồng lên khi nó còn đang xử lý dở
// (PENDING: chờ duyệt: DRAFT: đã bị yêu cầu sửa lại và đang chờ trình lại qua đúng luồng đó) —
// REJECTED KHÔNG được coi là chặn, vì đó là kết quả CUỐI của lượt đó, không phải đang xử lý dở,
// nếu coi REJECTED là chặn thì tài liệu bị từ chối sẽ vĩnh viễn không thể cập nhật được nữa.
function isDocFamilyLatestBlocking(latest) {
  return !latest || latest.status === 'PENDING' || latest.status === 'DRAFT';
}

// Đổi giữa "Nhập mới" (mã tự sinh, phiên bản luôn v1.0, chọn Phòng ban/Phân loại như cũ) và "Cập nhật"
// (khoá Mã/Phòng ban/Phân loại theo đúng tài liệu đã chọn, chỉ đổi Tệp + Tóm tắt + Phiên bản mới).
function onDocOpModeChange() {
  const mode = document.getElementById('docOpMode').value;
  const isUpdate = mode === 'UPDATE';
  document.getElementById('docUpdateTargetWrap').classList.toggle('hidden', !isUpdate);
  document.getElementById('selDept').disabled = isUpdate;
  document.getElementById('selCat').disabled = isUpdate;

  const verInput = document.getElementById('docVer');
  verInput.readOnly = !isUpdate;
  verInput.classList.toggle('bg-gray-100', !isUpdate);

  if (isUpdate) {
    populateDocUpdateTargets();
    document.getElementById('docUpdateTarget').value = '';
    document.getElementById('docCode').value = '';
    document.getElementById('docTitle').value = '';
    verInput.value = '';
    document.getElementById('selDept').value = '';
    document.getElementById('selCat').value = '';
  } else {
    document.getElementById('docTitle').value = '';
    verInput.value = 'v1.0';
    refreshDocCodePreview();
  }
}

// Mã Tài Liệu tự sinh sống theo Phòng ban/Phân loại đang chọn (chỉ áp dụng ở chế độ "Nhập mới") —
// gọi lại mỗi khi 2 lựa chọn này đổi để người trình luôn thấy trước mã sẽ được cấp.
function refreshDocCodePreview() {
  if (document.getElementById('docOpMode').value !== 'NEW') return;
  const dept = document.getElementById('selDept').value;
  const cat = document.getElementById('selCat').value;
  document.getElementById('docCode').value = (dept && cat) ? generateDocCode(cat, dept) : '';
}

// Danh sách tài liệu được phép "Cập nhật" — chỉ tài liệu GỐC mà version MỚI NHẤT không đang xử lý dở
// (không cho cập nhật khi đang có version chờ duyệt hoặc đang chờ sửa & trình lại), và người dùng có
// quyền tạo tài liệu cho đúng phòng ban đó.
function populateDocUpdateTargets() {
  const sel = document.getElementById('docUpdateTarget');
  if (!sel) return;
  const prevVal = sel.value;

  const roots = DB.docs.filter(d => d.rootDocId == null);
  const scope = { all: !!currentUser.perms?.uploadAll, depts: currentUser.perms?.uploadDepts || [] };
  const eligible = roots.filter(root => {
    const latest = getDocFamilyLatest(root.id);
    if (isDocFamilyLatestBlocking(latest)) return false;
    return currentUser.perms?.admin || scopeAllows(currentUser, scope, root.dept);
  });

  sel.innerHTML = '<option value="">-- Chọn tài liệu --</option>' + eligible.map(root => {
    const latest = getDocFamilyLatest(root.id);
    return `<option value="${root.id}">${escapeHtml(root.displayCode || root.code)} — ${escapeHtml(root.title)} (hiện tại: ${escapeHtml(latest.ver)})</option>`;
  }).join('');

  if (eligible.some(r => String(r.id) === prevVal)) sel.value = prevVal;
}

// Chọn xong tài liệu cần cập nhật -> khoá Mã/Tiêu đề/Phòng ban/Phân loại theo đúng tài liệu gốc, đề
// xuất sẵn số phiên bản tiếp theo (vẫn cho sửa lại nếu cần).
function onDocUpdateTargetChange() {
  const rootId = Number(document.getElementById('docUpdateTarget').value);
  const root = DB.docs.find(d => d.id === rootId);
  if (!root) {
    document.getElementById('docCode').value = '';
    document.getElementById('docTitle').value = '';
    document.getElementById('docVer').value = '';
    document.getElementById('selDept').value = '';
    document.getElementById('selCat').value = '';
    return;
  }
  const latest = getDocFamilyLatest(rootId);
  document.getElementById('docCode').value = root.displayCode || root.code;
  document.getElementById('docTitle').value = root.title;
  document.getElementById('selDept').value = root.dept;
  document.getElementById('selCat').value = root.cat;

  const prevNum = parseFloat(latest.ver.replace(/[^\d.]/g, ''));
  document.getElementById('docVer').value = Number.isFinite(prevNum) ? `v${(prevNum + 1).toFixed(1)}` : `v${(latest.versionNumber || 1) + 1}.0`;
}

function renderDocs() {
  const tbody = document.getElementById('docTableBody');
  if (!tbody) return;

  const keyword = (document.getElementById('filterKeyword')?.value || '').toLowerCase().trim();
  const deptFilter = document.getElementById('filterDept')?.value || '';
  const statusFilter = document.getElementById('filterStatus')?.value || '';
  const docTypeFilter = document.getElementById('filterDocType')?.value || '';
  const fromDate = document.getElementById('filterFromDate')?.value || '';
  const toDate = document.getElementById('filterToDate')?.value || '';

  // Kiểm tra quyền xem — tài liệu đã APPROVED xét quyền Xem Đã Duyệt, còn tài liệu đang xử lý / bị từ
  // chối (PENDING/REJECTED = "bản nháp") xét quyền Xem Bản Nháp; người tải lên luôn xem được bài của
  // chính mình.
  const canViewDoc = doc => currentUser.perms.admin ||
    (doc.status === 'APPROVED'
      ? (currentUser.perms.viewApprovedAll || (currentUser.perms.viewApprovedDepts || []).includes(doc.dept))
      : (currentUser.perms.viewDraftAll || (currentUser.perms.viewDraftDepts || []).includes(doc.dept))
    ) ||
    (doc.uploader === currentUser.username);

  // Thẻ dashboard — đếm khớp CHÍNH XÁC những gì sẽ hiện ra khi bấm từng thẻ (xem filterDocByCard()).
  // "Tổng/Đã duyệt/Từ chối" đếm trên tài liệu GỐC (đúng những gì list hiện mặc định); "Chờ duyệt: Cập
  // nhật phiên bản" đếm riêng trên các bản ghi version (rootDocId != null) — trước đây không có cách
  // nào lọc/thấy nhanh các version đang chờ duyệt mà không mở rộng từng tài liệu gốc.
  const viewableDocs = DB.docs.filter(canViewDoc);
  const rootDocsAll = viewableDocs.filter(d => d.rootDocId == null);
  const versionDocsAll = viewableDocs.filter(d => d.rootDocId != null);
  const dashCards = [
    { key: '__ALL__', label: 'Tổng Tài Liệu', count: rootDocsAll.length, colorClass: 'border-l-blue-500' },
    { key: 'PENDING_NEW', label: 'Chờ Duyệt: Tài Liệu Mới', count: rootDocsAll.filter(d => d.status === 'PENDING').length, colorClass: 'border-l-yellow-500' },
    { key: 'PENDING_VERSION', label: 'Chờ Duyệt: Cập Nhật Phiên Bản', count: versionDocsAll.filter(d => d.status === 'PENDING').length, colorClass: 'border-l-orange-500' },
    { key: 'APPROVED', label: 'Đã Phê Duyệt', count: rootDocsAll.filter(d => d.status === 'APPROVED').length, colorClass: 'border-l-green-500' },
    { key: 'REJECTED', label: 'Từ Chối / Trả Về', count: rootDocsAll.filter(d => d.status === 'REJECTED').length, colorClass: 'border-l-red-500' },
    { key: 'DRAFT', label: 'Chờ Chỉnh Sửa (Cần Bổ Sung)', count: rootDocsAll.filter(d => d.status === 'DRAFT').length, colorClass: 'border-l-purple-500' }
  ];
  let activeCardKey = '__ALL__';
  if (statusFilter === 'PENDING') activeCardKey = docTypeFilter === 'VERSION' ? 'PENDING_VERSION' : 'PENDING_NEW';
  else if (statusFilter === 'APPROVED') activeCardKey = 'APPROVED';
  else if (statusFilter === 'REJECTED') activeCardKey = 'REJECTED';
  else if (statusFilter === 'DRAFT') activeCardKey = 'DRAFT';
  document.getElementById('docDashboardCards').innerHTML = buildDashboardCardsHTML(dashCards, activeCardKey, 'filterDocByCard');

  // Lọc tài liệu theo quyền truy cập phòng ban & bộ lọc. Mặc định (docTypeFilter rỗng/'NEW') chỉ hiện
  // tài liệu GỐC (rootDocId == null) ở cấp cao nhất, version con chỉ hiện khi mở rộng (toggleDocFamily()).
  // Khi lọc riêng "Cập nhật phiên bản" (docTypeFilter === 'VERSION'), hiện thẳng các bản ghi version như
  // hàng cấp cao nhất (không lồng dưới bản gốc) để người duyệt thấy ngay các phiên bản đang chờ xử lý.
  let filtered = DB.docs.filter(doc => {
    if (docTypeFilter === 'VERSION') { if (doc.rootDocId == null) return false; }
    else { if (doc.rootDocId != null) return false; }

    if (!canViewDoc(doc)) return false;

    if (deptFilter && doc.dept !== deptFilter) return false;
    if (statusFilter && doc.status !== statusFilter) return false;

    if (keyword) {
      const matchCode = (doc.code || '').toLowerCase().includes(keyword);
      const matchTitle = (doc.title || '').toLowerCase().includes(keyword);
      const matchSummary = (doc.summary || '').toLowerCase().includes(keyword);
      if (!matchCode && !matchTitle && !matchSummary) return false;
    }

    if (!isInDateRange(doc.createdAt, fromDate, toDate)) return false;

    return true;
  });

  // Phân trang — dùng bộ dùng chung (xem "BỘ TÌM KIẾM / LỌC / PHÂN TRANG DÙNG CHUNG" phía trên).
  document.getElementById('paginationContainer_doc').innerHTML = buildPaginationBoxHTML('doc', 'renderDocs');
  const pageDocs = paginateList('doc', filtered, 'renderDocs', 'tài liệu');

  if (pageDocs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center p-6 text-gray-500 italic">Không tìm thấy tài liệu phù hợp.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageDocs.map(doc => {
    const versions = getDocFamily(doc.id).filter(d => d.id !== doc.id);
    const isExpanded = expandedDocFamilies.has(doc.id);
    const rootRowHTML = buildDocRowHTML(doc, { versionCount: versions.length, isExpanded });
    const childRowsHTML = isExpanded ? versions.map(v => buildDocRowHTML(v, { isChild: true })).join('') : '';
    return rootRowHTML + childRowsHTML;
  }).join('');
}

// Bấm nút mở/đóng danh sách version con của 1 tài liệu gốc trong "Danh Sách Tài Liệu Trong Hệ Thống".
function toggleDocFamily(rootId) {
  if (expandedDocFamilies.has(rootId)) expandedDocFamilies.delete(rootId);
  else expandedDocFamilies.add(rootId);
  renderDocs();
}

// Dựng 1 dòng <tr> trong "Danh Sách Tài Liệu Trong Hệ Thống" — dùng chung cho cả tài liệu gốc (có thể
// kèm nút mở rộng "▸"/badge số version nếu có version con) và version con (thụt lề + icon "↳" để phân
// biệt trực quan với tài liệu không có version nào). Mỗi version có Thao Tác RIÊNG vì mỗi version là
// 1 lượt phê duyệt độc lập (status/currentStep/history của chính nó, không dùng chung với bản gốc).
function buildDocRowHTML(doc, { versionCount = 0, isExpanded = false, isChild = false } = {}) {
  const wfConfig = DB.deptWorkflows[doc.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  const wf = DB.workflows.find(w => w.id === wfConfig.workflowId) || { steps: [{ name: 'Sếp duyệt' }] };

  const currentStepApprovers = wfConfig.approvers ? (wfConfig.approvers[doc.currentStep] || []) : [];
  const canApprove = (doc.status === 'PENDING') && canApproveStep(currentUser, currentStepApprovers, doc.history, doc.currentStep);

  let progressBadge = '';
  if (doc.status === 'APPROVED') {
    progressBadge = `<span class="px-2 py-1 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã phê duyệt hoàn tất</span>`;
  } else if (doc.status === 'REJECTED') {
    progressBadge = `<span class="px-2 py-1 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Bị từ chối / Trả về</span>`;
  } else if (doc.status === 'DRAFT') {
    // "Bổ Sung" (REQUEST_CHANGES) — người duyệt trả hồ sơ về NHÁP để người tải lên sửa lại toàn bộ nội
    // dung + tệp rồi gửi lại (xem openBosungEditModal()/lib/recordActions.js editDocDraft()).
    progressBadge = `<span class="px-2 py-1 bg-orange-100 text-orange-800 rounded font-bold text-xs">✏️ Cần bổ sung — chờ sửa lại</span>`;
  } else {
    const stepName = wf.steps[doc.currentStep - 1]?.name || `Bước ${doc.currentStep}`;
    const progressText = getStepApprovalProgressText(currentStepApprovers, doc.history, doc.currentStep);
    progressBadge = `<span class="px-2 py-1 bg-yellow-100 text-yellow-800 rounded font-semibold text-xs">⏳ Đang ở Bước ${doc.currentStep}/${wf.steps.length}: ${escapeHtml(stepName)}${escapeHtml(progressText)}</span>`;
  }

  const codeText = escapeHtml(doc.displayCode || doc.code);
  const codeCellHTML = isChild
    ? `<span class="pl-4 text-gray-500">↳ ${codeText}</span>`
    : (versionCount > 0
        ? `<button type="button" data-op="toggleDocFamily" data-arg0="${doc.id}" class="font-bold hover:underline" title="${isExpanded ? 'Thu gọn' : 'Xem các phiên bản'}">${isExpanded ? '▾' : '▸'} ${codeText}</button>
           <span class="ml-1 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[10px] font-bold align-middle" title="Có ${versionCount} phiên bản khác">🗂️ ${versionCount + 1} phiên bản</span>`
        : codeText);

  return `
    <tr class="hover:bg-gray-50 transition border-b ${isChild ? 'bg-purple-50/40' : ''}">
      <td class="border p-2 font-mono font-bold text-blue-700">${codeCellHTML}</td>
      <td class="border p-2">
        <div class="font-bold text-gray-800">${escapeHtml(doc.title)}</div>
        <div class="text-xs text-gray-500 line-clamp-2 mt-0.5">${escapeHtml(doc.summary)}</div>
      </td>
      <td class="border p-2 font-semibold text-gray-700">${escapeHtml(doc.dept)}</td>
      <td class="border p-2 text-gray-600">${escapeHtml(doc.cat)}</td>
      <td class="border p-2 text-center font-bold text-purple-700">${escapeHtml(doc.ver)}</td>
      <td class="border p-2">${progressBadge}</td>
      <td class="border p-2 text-center space-x-1">
        ${(() => {
          const canDownload = (doc.fileUrl || doc.fileData) && canDownloadFile(currentUser, 'doc', doc.dept, doc.uploader);
          const secondaryOptions = [];
          let primaryBtnHTML;
          if (canApprove) {
            primaryBtnHTML = `<button data-op="runDocAction" data-arg0="${doc.id}" data-arg1="approve" class="px-2 py-1 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700 font-semibold" title="Phê duyệt tài liệu">✅ Duyệt</button>`;
            secondaryOptions.push({ value: 'reject', label: '❌ Từ chối' });
            secondaryOptions.push({ value: 'requestChanges', label: '🔄 Bổ Sung' });
            secondaryOptions.push({ value: 'view', label: '📋 Chi tiết' });
          } else {
            primaryBtnHTML = `<button data-op="runDocAction" data-arg0="${doc.id}" data-arg1="view" class="px-2 py-1 bg-gray-600 text-white rounded text-xs hover:bg-gray-700 font-semibold" title="Xem chi tiết & lịch sử phiên bản">📋 Chi tiết</button>`;
          }
          // "Sửa & Gửi Lại" — chỉ chính người tải lên, chỉ khi hồ sơ đang cần bổ sung (NHÁP do
          // REQUEST_CHANGES, xem openBosungEditModal()).
          if (doc.status === 'DRAFT' && doc.uploader === currentUser.username) {
            secondaryOptions.push({ value: 'editDraft', label: '✏️ Sửa & Gửi Lại' });
          }
          if (canDownload) secondaryOptions.push({ value: 'download', label: '⬇️ Tải' });
          if (currentUser.perms?.admin) secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });
          return buildActionCell(doc.id, primaryBtnHTML, secondaryOptions, 'runDocAction');
        })()}
      </td>
    </tr>
  `;
}

// Hàm điều phối cho khối "Thao Tác" của Tài liệu (xem buildActionCell()) — 'view' giờ mở modal "Chi
// Tiết Tài Liệu" (lịch sử phiên bản) thay vì mở thẳng khung xem tệp như trước (xem viewDocDetails()).
function runDocAction(id, action) {
  const doc = DB.docs.find(d => d.id === id);
  if (!doc) return;
  switch (action) {
    case 'view': viewDocDetails(id); break;
    case 'approve': approveDoc(id); break;
    case 'reject': rejectDoc(id); break;
    case 'requestChanges': requestWorkflowChangesAction('docs', id, DB.docs, 'renderDocs', 'người tải lên'); break;
    case 'editDraft': openBosungEditModal('docs', id); break;
    case 'download': downloadDocFile(id); break;
    case 'delete': deleteDocAction(id); break;
  }
}

function deleteDocAction(id) {
  const doc = DB.docs.find(d => d.id === id);
  if (!doc) return;
  deleteRecordAdminOnly('docs', id, `tài liệu ${doc.displayCode || doc.code}`, () => {
    DB.docs = DB.docs.filter(x => x.id !== id);
    logSystemAction('DOC', 'DELETE_DOC', `Xóa tài liệu [${doc.code} - ${doc.title}]`, 'SUCCESS', doc.code);
    renderDocs();
  });
}

// Tải trực tiếp tệp gốc của 1 tài liệu/version — tự tạo và bấm 1 thẻ <a download> tạm thời (dùng
// chung cho cả dropdown "Khác ▾" ở Thao Tác lẫn từng dòng version trong modal "Chi Tiết Tài Liệu").
function downloadDocFile(id) {
  const doc = DB.docs.find(d => d.id === id);
  if (!doc) return;
  const a = document.createElement('a');
  a.href = attachmentDownloadUrl(doc.fileUrl, doc.fileData, doc.fileName || doc.code);
  a.download = doc.fileName || doc.code;
  document.body.appendChild(a);
  a.click();
  a.remove();
  logSystemAction('DOC', 'DOWNLOAD_DOC', `Tải tệp tài liệu [${doc.code} - ${doc.title}]`, 'SUCCESS', doc.code);
}

async function uploadDoc(e) {
  e.preventDefault();
  const mode = document.getElementById('docOpMode').value;
  const title = document.getElementById('docTitle').value.trim();
  const ver = document.getElementById('docVer').value.trim();
  const summary = document.getElementById('docSummary').value.trim();
  const fileInput = document.getElementById('docFile');

  // "Nhập mới": Phòng ban/Phân loại người trình tự chọn, Mã Tài Liệu tự sinh theo đó, luôn là version 1.
  // "Cập nhật": Phòng ban/Phân loại/Mã Tài Liệu bị KHOÁ theo đúng tài liệu gốc đã chọn (readSelect ở
  // đây chứ không tin nguyên si giá trị đang hiện trên input, phòng khi người dùng đổi lựa chọn ở
  // #docUpdateTarget rồi bằng cách nào đó input vẫn giữ giá trị cũ) — số phiên bản tự tăng tiếp theo.
  let dept, cat, displayCode, code, versionNumber, rootDocId;

  if (mode === 'UPDATE') {
    const rootId = Number(document.getElementById('docUpdateTarget').value);
    const rootDoc = DB.docs.find(d => d.id === rootId);
    if (!rootDoc) return alert('Vui lòng chọn tài liệu cần cập nhật!');
    const latest = getDocFamilyLatest(rootId);
    if (isDocFamilyLatestBlocking(latest)) {
      return alert('⛔ Không thể cập nhật khi phiên bản mới nhất của tài liệu này đang chờ xử lý (chờ duyệt hoặc chờ sửa & trình lại)!');
    }
    dept = rootDoc.dept;
    cat = rootDoc.cat;
    displayCode = rootDoc.displayCode || rootDoc.code;
    versionNumber = (latest.versionNumber || getDocFamily(rootId).length) + 1;
    code = `${displayCode}-V${versionNumber}`;
    rootDocId = rootId;
  } else {
    dept = document.getElementById('selDept').value;
    cat = document.getElementById('selCat').value;
    if (!dept || !cat) return alert('Vui lòng chọn Phòng Ban Trình và Phân Loại!');
    displayCode = generateDocCode(cat, dept);
    code = displayCode;
    versionNumber = 1;
    rootDocId = null;
  }

  if (DB.docs.some(d => d.code === code)) {
    return alert('Mã tài liệu đã tồn tại trong hệ thống!');
  }

  const file = fileInput.files[0];
  if (!file) return alert('Vui lòng chọn tệp tài liệu!');

  let uploaded, customData;
  try {
    uploaded = await uploadFileToServer(file, 'doc');
    customData = await collectDynamicFieldsData('DOC');
  } catch (err) {
    return alert(`⛔ Tải tệp lên thất bại: ${err.message}`);
  }

  const docPayload = {
    code: code,
    displayCode: displayCode,
    versionNumber: versionNumber,
    rootDocId: rootDocId,
    title: title,
    ver: ver,
    dept: dept,
    cat: cat,
    summary: summary,
    customData: customData,
    fileName: uploaded.fileName,
    fileType: uploaded.fileType,
    fileUrl: uploaded.fileUrl,
    createdAt: new Date().toLocaleString('vi-VN'),
    status: 'PENDING',
    currentStep: 1,
    history: [
      {
        step: 0,
        stepName: 'Tải lên & Trình ký',
        approver: currentUser.name,
        username: currentUser.username,
        action: 'UPLOADED',
        time: new Date().toLocaleString('vi-VN')
      }
    ]
  };

  let newDoc;
  try {
    newDoc = (await callCreateAction('docs', docPayload)).item;
  } catch (err) {
    return alert('⛔ ' + err.message);
  }

  DB.docs.unshift(newDoc);
  logSystemAction('DOC', 'UPLOAD_DOC', `Tải lên tài liệu ${mode === 'UPDATE' ? 'phiên bản mới' : 'mới'} [${code} - ${title}]`, 'SUCCESS', code);

  const newDocWfConfig = DB.deptWorkflows[dept];
  const newDocApprovers = newDocWfConfig?.approvers?.[1] || [];
  if (newDocApprovers.length) {
    notifyUsersByEmail('DOC', 'NOTIFY_APPROVAL_NEEDED', code, newDocApprovers,
      `[VPDT] Tài liệu ${code} cần bạn phê duyệt`,
      `Tài liệu "${title}" (${code}) do ${currentUser.name} tải lên đang chờ bạn phê duyệt.`);
  }

  alert('✅ Tải lên và trình ký tài liệu thành công!');
  document.getElementById('docForm').reset();
  document.getElementById('docOpMode').value = 'NEW';
  onDocOpModeChange();
  renderDocs();
}

// ============ GIẤY PHÉP (Hành Chính) — phân quyền phẳng licenseCreate/licenseApprove/licenseView (KHÔNG
// đi qua quy trình phòng ban), versioning "cộng thêm phiên bản" y hệt Tài Liệu (rootLicenseId/expand-
// collapse/nút hành động), cộng thêm lifecycleStatus riêng (RENEWING/REVOKED, bấm tay) chỉ có ý nghĩa khi
// đã APPROVED. Xem lib/createValidation.js licenses.extraValidate + lib/recordActions.js khối "GIẤY PHÉP"
// + lib/recordViewScope.js canViewLicense()/filterLicensesForUser(). ============

function onLicenseOpModeChange() {
  const mode = document.getElementById('licenseOpMode').value;
  const isUpdate = mode === 'UPDATE';
  document.getElementById('licenseUpdateTargetWrap').classList.toggle('hidden', !isUpdate);
  ['licenseCompanyName', 'licenseLocationName', 'licenseType'].forEach(id => {
    document.getElementById(id).disabled = isUpdate;
  });
  if (isUpdate) {
    populateLicenseUpdateTargets();
    document.getElementById('licenseUpdateTarget').value = '';
    onLicenseUpdateTargetChange();
  } else {
    document.getElementById('licenseCode').value = generateHcrcCode(DB.licenses, 'GP');
    document.getElementById('licenseCompanyName').value = '';
    document.getElementById('licenseLocationName').value = '';
    document.getElementById('licenseOperatingStatus').value = 'ACTIVE';
    document.getElementById('licenseType').value = '';
    document.getElementById('licenseNumber').value = '';
    document.getElementById('licenseIssueDate').value = '';
    document.getElementById('licenseExpiryDate').value = '';
    document.getElementById('licenseIssuingAuthority').value = '';
  }
}

function getLicenseFamily(anyId) {
  const item = DB.licenses.find(l => l.id === anyId);
  if (!item) return [];
  const rootId = item.rootLicenseId == null ? item.id : item.rootLicenseId;
  return DB.licenses.filter(l => l.id === rootId || l.rootLicenseId === rootId)
    .sort((a, b) => (a.versionNumber || 1) - (b.versionNumber || 1));
}
function getLicenseFamilyLatest(anyId) {
  const family = getLicenseFamily(anyId);
  return family[family.length - 1];
}
// REJECTED KHÔNG chặn (là kết quả cuối, không phải đang xử lý dở) — khớp đúng nguyên tắc
// isDocFamilyLatestBlocking() ở Tài Liệu.
function isLicenseFamilyLatestBlocking(latest) {
  return !latest || latest.status === 'PENDING';
}

// Chỉ chính người tạo (hoặc admin) mới được cập nhật — quyền phẳng, không theo scope phòng ban như
// Tài Liệu (uploadDepts/uploadAll).
function populateLicenseUpdateTargets() {
  const sel = document.getElementById('licenseUpdateTarget');
  if (!sel) return;
  const prevVal = sel.value;
  const roots = DB.licenses.filter(l => l.rootLicenseId == null);
  const eligible = roots.filter(root => {
    if (!(currentUser.perms?.admin || root.creator === currentUser.username)) return false;
    const latest = getLicenseFamilyLatest(root.id);
    return !isLicenseFamilyLatestBlocking(latest);
  });
  sel.innerHTML = '<option value="">-- Chọn giấy phép --</option>' + eligible.map(root => {
    const latest = getLicenseFamilyLatest(root.id);
    return `<option value="${root.id}">${escapeHtml(root.displayCode || root.code)} — ${escapeHtml(root.licenseType)} (${escapeHtml(root.locationName)}, hiện tại v${latest.versionNumber || 1})</option>`;
  }).join('');
  if (eligible.some(r => String(r.id) === prevVal)) sel.value = prevVal;
}

function onLicenseUpdateTargetChange() {
  const rootId = Number(document.getElementById('licenseUpdateTarget').value);
  const root = DB.licenses.find(l => l.id === rootId);
  if (!root) {
    document.getElementById('licenseCode').value = '';
    return;
  }
  const latest = getLicenseFamilyLatest(rootId);
  document.getElementById('licenseCode').value = root.displayCode || root.code;
  document.getElementById('licenseCompanyName').value = root.companyName;
  document.getElementById('licenseLocationName').value = root.locationName;
  document.getElementById('licenseOperatingStatus').value = latest.operatingStatus || root.operatingStatus;
  document.getElementById('licenseType').value = root.licenseType;
  document.getElementById('licenseNumber').value = latest.licenseNumber || '';
  document.getElementById('licenseIssueDate').value = '';
  document.getElementById('licenseExpiryDate').value = '';
  document.getElementById('licenseIssuingAuthority').value = latest.issuingAuthority || '';
}

// Tình trạng hiệu lực — CHỈ có ý nghĩa khi status==='APPROVED' (khớp lib/recordActions.js
// setLicenseRenewing()/revokeLicense()); "Sắp hết hạn" cố định ngưỡng 30 ngày cho MÀU HIỂN THỊ/lọc
// nhanh trên list (KHÁC hệ ngưỡng nhắc email tuỳ chỉnh licenseExpiryReminderDays — 2 khái niệm độc lập).
function computeLicenseLifecycleState(item) {
  if (!item || item.status !== 'APPROVED') return null;
  if (item.lifecycleStatus === 'REVOKED') return 'REVOKED';
  if (item.lifecycleStatus === 'RENEWING') return 'RENEWING';
  const expiry = new Date(item.expiryDate);
  if (isNaN(expiry.getTime())) return 'VALID';
  const now = new Date();
  const startExpiry = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate());
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((startExpiry - startNow) / 86400000);
  if (diffDays < 0) return 'EXPIRED';
  if (diffDays <= 30) return 'EXPIRING';
  return 'VALID';
}
const LICENSE_LIFECYCLE_LABELS = {
  VALID: { label: '🟢 Còn hiệu lực', cls: 'bg-green-100 text-green-800' },
  EXPIRING: { label: '🟡 Sắp hết hạn', cls: 'bg-yellow-100 text-yellow-800' },
  EXPIRED: { label: '🔴 Hết hạn', cls: 'bg-red-100 text-red-800' },
  RENEWING: { label: '🔵 Đang gia hạn', cls: 'bg-sky-100 text-sky-800' },
  REVOKED: { label: '⚫ Đã thu hồi', cls: 'bg-gray-300 text-gray-700' }
};

function filterLicenseByCard(key) {
  const map = {
    __ALL__: { filterLicenseStatus: '', filterLicenseType: '', filterLicenseLifecycle: '' },
    PENDING_NEW: { filterLicenseStatus: 'PENDING', filterLicenseType: 'NEW', filterLicenseLifecycle: '' },
    PENDING_VERSION: { filterLicenseStatus: 'PENDING', filterLicenseType: 'VERSION', filterLicenseLifecycle: '' },
    EXPIRING: { filterLicenseStatus: '', filterLicenseType: '', filterLicenseLifecycle: 'EXPIRING' },
    EXPIRED: { filterLicenseStatus: '', filterLicenseType: '', filterLicenseLifecycle: 'EXPIRED' }
  };
  const box = document.querySelector('#licenseSection .filter-box-details');
  if (box) box.open = true;
  applyDashboardCardFilter(map[key] || {}, 'license', renderLicenses);
}
function onLicenseFilterChange() {
  resetListPage('license');
  renderLicenses();
}

function renderLicenses() {
  const tbody = document.getElementById('licenseTableBody');
  if (!tbody) return;

  document.getElementById('licenseUploadBox').classList.toggle('hidden', !(currentUser.perms?.admin || currentUser.perms?.licenseCreate));
  sddSetOptions('licenseTypeDatalist', DB.licenseTypes || []);

  const keyword = (document.getElementById('filterLicenseKeyword')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('filterLicenseStatus')?.value || '';
  const typeFilter = document.getElementById('filterLicenseType')?.value || '';
  const lifecycleFilter = document.getElementById('filterLicenseLifecycle')?.value || '';
  const fromDate = document.getElementById('filterLicenseFromDate')?.value || '';
  const toDate = document.getElementById('filterLicenseToDate')?.value || '';

  // Quyền xem — khớp canViewLicense() ở lib/recordViewScope.js: admin/licenseApprove/licenseView thấy
  // hết, licenseCreate (không có 2 quyền kia) chỉ thấy hồ sơ của chính mình. Server ĐÃ lọc sẵn ở GET
  // /api/data (routes/data.js filterLicensesForUser) — đây chỉ double-check phía client.
  const canViewThisLicense = item => currentUser.perms?.admin || currentUser.perms?.licenseApprove || currentUser.perms?.licenseView || item.creator === currentUser.username;
  const canApprove = !!(currentUser.perms?.admin || currentUser.perms?.licenseApprove);

  const viewableLicenses = DB.licenses.filter(canViewThisLicense);
  const rootAll = viewableLicenses.filter(l => l.rootLicenseId == null);
  const versionAll = viewableLicenses.filter(l => l.rootLicenseId != null);
  const dashCards = [
    { key: '__ALL__', label: 'Tổng Giấy Phép', count: rootAll.length, colorClass: 'border-l-blue-500' },
    { key: 'PENDING_NEW', label: 'Chờ Duyệt: Giấy Phép Mới', count: rootAll.filter(l => l.status === 'PENDING').length, colorClass: 'border-l-yellow-500' },
    { key: 'PENDING_VERSION', label: 'Chờ Duyệt: Cập Nhật', count: versionAll.filter(l => l.status === 'PENDING').length, colorClass: 'border-l-orange-500' },
    { key: 'EXPIRING', label: 'Sắp Hết Hạn (≤30 ngày)', count: rootAll.filter(l => computeLicenseLifecycleState(getLicenseFamilyLatest(l.id)) === 'EXPIRING').length, colorClass: 'border-l-amber-500' },
    { key: 'EXPIRED', label: 'Đã Hết Hạn', count: rootAll.filter(l => computeLicenseLifecycleState(getLicenseFamilyLatest(l.id)) === 'EXPIRED').length, colorClass: 'border-l-red-500' }
  ];
  let activeCardKey = '__ALL__';
  if (statusFilter === 'PENDING') activeCardKey = typeFilter === 'VERSION' ? 'PENDING_VERSION' : 'PENDING_NEW';
  else if (lifecycleFilter === 'EXPIRING') activeCardKey = 'EXPIRING';
  else if (lifecycleFilter === 'EXPIRED') activeCardKey = 'EXPIRED';
  document.getElementById('licenseDashboardCards').innerHTML = buildDashboardCardsHTML(dashCards, activeCardKey, 'filterLicenseByCard');

  let filtered = DB.licenses.filter(item => {
    if (typeFilter === 'VERSION') { if (item.rootLicenseId == null) return false; }
    else { if (item.rootLicenseId != null) return false; }

    if (!canViewThisLicense(item)) return false;
    if (statusFilter && item.status !== statusFilter) return false;
    if (lifecycleFilter && computeLicenseLifecycleState(getLicenseFamilyLatest(item.id)) !== lifecycleFilter) return false;

    if (keyword) {
      const hay = [item.code, item.displayCode, item.companyName, item.locationName, item.licenseType, item.licenseNumber]
        .map(v => (v || '').toLowerCase());
      if (!hay.some(v => v.includes(keyword))) return false;
    }

    if (!isInDateRange(item.createdAt, fromDate, toDate)) return false;
    return true;
  });

  document.getElementById('paginationContainer_license').innerHTML = buildPaginationBoxHTML('license', 'renderLicenses');
  const pageItems = paginateList('license', filtered, 'renderLicenses', 'giấy phép');

  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center p-6 text-gray-500 italic">Không tìm thấy giấy phép phù hợp.</td></tr>`;
    return;
  }

  tbody.innerHTML = pageItems.map(item => {
    const versions = getLicenseFamily(item.id).filter(l => l.id !== item.id);
    const isExpanded = expandedLicenseFamilies.has(item.id);
    const rootRowHTML = buildLicenseRowHTML(item, { versionCount: versions.length, isExpanded, canApprove });
    const childRowsHTML = isExpanded ? versions.map(v => buildLicenseRowHTML(v, { isChild: true, canApprove })).join('') : '';
    return rootRowHTML + childRowsHTML;
  }).join('');
}

function toggleLicenseFamily(rootId) {
  if (expandedLicenseFamilies.has(rootId)) expandedLicenseFamilies.delete(rootId);
  else expandedLicenseFamilies.add(rootId);
  renderLicenses();
}

function buildLicenseRowHTML(item, { versionCount = 0, isExpanded = false, isChild = false, canApprove = false } = {}) {
  const approvalBadge = item.status === 'APPROVED'
    ? `<span class="px-2 py-1 bg-green-100 text-green-800 rounded font-bold text-xs">✅ Đã duyệt</span>`
    : item.status === 'REJECTED'
      ? `<span class="px-2 py-1 bg-red-100 text-red-800 rounded font-bold text-xs">❌ Từ chối</span>`
      : `<span class="px-2 py-1 bg-yellow-100 text-yellow-800 rounded font-semibold text-xs">⏳ Chờ duyệt</span>`;

  const lifecycleKey = computeLicenseLifecycleState(item);
  const lifecycleBadge = lifecycleKey
    ? `<span class="px-2 py-1 rounded font-bold text-xs ${LICENSE_LIFECYCLE_LABELS[lifecycleKey].cls}">${escapeHtml(LICENSE_LIFECYCLE_LABELS[lifecycleKey].label)}</span>`
    : '<span class="text-gray-400 text-xs">—</span>';

  const codeText = escapeHtml(item.displayCode || item.code);
  const codeCellHTML = isChild
    ? `<span class="pl-4 text-gray-500">↳ ${codeText}</span>`
    : (versionCount > 0
        ? `<button type="button" data-op="toggleLicenseFamily" data-arg0="${item.id}" class="font-bold hover:underline" title="${isExpanded ? 'Thu gọn' : 'Xem các phiên bản'}">${isExpanded ? '▾' : '▸'} ${codeText}</button>
           <span class="ml-1 px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full text-[10px] font-bold align-middle" title="Có ${versionCount} phiên bản khác">🗂️ ${versionCount + 1} phiên bản</span>`
        : codeText);

  return `
    <tr class="hover:bg-gray-50 transition border-b ${isChild ? 'bg-purple-50/40' : ''}">
      <td class="border p-2 font-mono font-bold text-blue-700">${codeCellHTML}</td>
      <td class="border p-2">
        <div class="font-bold text-gray-800">${escapeHtml(item.companyName)}</div>
        <div class="text-xs text-gray-500">${escapeHtml(item.locationName)}</div>
      </td>
      <td class="border p-2 text-gray-700">${escapeHtml(item.licenseType)}</td>
      <td class="border p-2 text-gray-700">${escapeHtml(item.licenseNumber)}</td>
      <td class="border p-2 text-xs text-gray-600">${escapeHtml(item.issueDate)} → ${escapeHtml(item.expiryDate)}</td>
      <td class="border p-2 text-center">${approvalBadge}</td>
      <td class="border p-2 text-center">${lifecycleBadge}</td>
      <td class="border p-2 text-center space-x-1">
        ${(() => {
          const canDownload = !!item.fileUrl && (currentUser.perms?.admin || currentUser.perms?.licenseApprove || currentUser.perms?.licenseView || item.creator === currentUser.username);
          const secondaryOptions = [];
          let primaryBtnHTML;
          if (canApprove && item.status === 'PENDING') {
            primaryBtnHTML = `<button data-op="runLicenseAction" data-arg0="${item.id}" data-arg1="approve" class="px-2 py-1 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700 font-semibold" title="Phê duyệt giấy phép">✅ Duyệt</button>`;
            secondaryOptions.push({ value: 'reject', label: '❌ Từ chối' });
            secondaryOptions.push({ value: 'view', label: '📋 Chi tiết' });
          } else {
            primaryBtnHTML = `<button data-op="runLicenseAction" data-arg0="${item.id}" data-arg1="view" class="px-2 py-1 bg-gray-600 text-white rounded text-xs hover:bg-gray-700 font-semibold" title="Xem chi tiết & lịch sử phiên bản">📋 Chi tiết</button>`;
          }
          if (canApprove && item.status === 'APPROVED') {
            if (item.lifecycleStatus !== 'REVOKED') {
              secondaryOptions.push(item.lifecycleStatus === 'RENEWING'
                ? { value: 'unsetRenewing', label: '🔵 Bỏ Đang Gia Hạn' }
                : { value: 'setRenewing', label: '🔄 Đánh Dấu Đang Gia Hạn' });
              secondaryOptions.push({ value: 'revoke', label: '⛔ Thu Hồi' });
            } else {
              secondaryOptions.push({ value: 'unrevoke', label: '↩️ Bỏ Thu Hồi' });
            }
          }
          if (canDownload) secondaryOptions.push({ value: 'download', label: '⬇️ Tải' });
          if (currentUser.perms?.admin) secondaryOptions.push({ value: 'delete', label: '🗑️ Xóa' });
          return buildActionCell(item.id, primaryBtnHTML, secondaryOptions, 'runLicenseAction');
        })()}
      </td>
    </tr>
  `;
}

function runLicenseAction(id, action) {
  const item = DB.licenses.find(l => l.id === id);
  if (!item) return;
  switch (action) {
    case 'view': viewLicenseDetails(id); break;
    case 'approve': approveLicenseAction(id); break;
    case 'reject': rejectLicenseAction(id); break;
    case 'setRenewing': setLicenseRenewingAction(id, true); break;
    case 'unsetRenewing': setLicenseRenewingAction(id, false); break;
    case 'revoke': revokeLicenseAction(id); break;
    case 'unrevoke': unrevokeLicenseAction(id); break;
    case 'download': downloadLicenseFile(id); break;
    case 'delete': deleteLicenseAction(id); break;
  }
}

function approveLicenseAction(id) {
  const item = DB.licenses.find(l => l.id === id);
  if (!item) return;
  showConfirmModal({
    title: 'Phê duyệt giấy phép',
    bodyHTML: `Bạn có chắc chắn muốn phê duyệt giấy phép "<b>${escapeHtml(item.licenseType)}</b>" (${escapeHtml(item.displayCode || item.code)})?`,
    confirmLabel: 'Phê Duyệt',
    onConfirm: async () => {
      let updated;
      try {
        updated = (await callRecordAction('licenses', id, 'approve', {})).item;
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const idx = DB.licenses.findIndex(x => x.id === id);
      if (idx !== -1) DB.licenses[idx] = updated;
      logSystemAction('LICENSE', 'APPROVE_LICENSE', `Phê duyệt giấy phép [${updated.code} - ${updated.licenseType}]`, 'SUCCESS', updated.code);
      renderLicenses();
      refreshApprovalSurfaces();
    }
  });
}

function rejectLicenseAction(id) {
  const item = DB.licenses.find(l => l.id === id);
  if (!item) return;
  const reason = prompt('Nhập lý do từ chối giấy phép:');
  if (reason === null) return;
  if (!reason.trim()) return alert('⛔ Vui lòng nhập lý do từ chối!');
  showConfirmModal({
    title: 'Từ chối giấy phép',
    bodyHTML: `Bạn có chắc chắn muốn từ chối giấy phép "<b>${escapeHtml(item.licenseType)}</b>" (${escapeHtml(item.displayCode || item.code)})?<br><span class="text-xs text-gray-500">Lý do: ${escapeHtml(reason.trim())}</span>`,
    confirmLabel: 'Từ Chối',
    onConfirm: async () => {
      let updated;
      try {
        updated = (await callRecordAction('licenses', id, 'reject', { reason: reason.trim() })).item;
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const idx = DB.licenses.findIndex(x => x.id === id);
      if (idx !== -1) DB.licenses[idx] = updated;
      logSystemAction('LICENSE', 'REJECT_LICENSE', `Từ chối giấy phép [${updated.code}] - Lý do: ${reason.trim()}`, 'WARNING', updated.code);
      renderLicenses();
      refreshApprovalSurfaces();
    }
  });
}

function setLicenseRenewingAction(id, renewing) {
  const item = DB.licenses.find(l => l.id === id);
  if (!item) return;
  showConfirmModal({
    title: renewing ? 'Đánh dấu Đang gia hạn' : 'Bỏ đánh dấu Đang gia hạn',
    bodyHTML: renewing
      ? `Đánh dấu giấy phép "<b>${escapeHtml(item.licenseType)}</b>" (${escapeHtml(item.displayCode || item.code)}) đang trong quá trình gia hạn?`
      : `Bỏ đánh dấu "Đang gia hạn" cho giấy phép "<b>${escapeHtml(item.licenseType)}</b>"?`,
    confirmLabel: renewing ? 'Đánh Dấu' : 'Bỏ Đánh Dấu',
    onConfirm: async () => {
      let updated;
      try {
        updated = (await callRecordAction('licenses', id, 'set-renewing', { renewing })).item;
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const idx = DB.licenses.findIndex(x => x.id === id);
      if (idx !== -1) DB.licenses[idx] = updated;
      logSystemAction('LICENSE', 'SET_LICENSE_RENEWING', `${renewing ? 'Đánh dấu' : 'Bỏ đánh dấu'} Đang gia hạn giấy phép [${updated.code}]`, 'SUCCESS', updated.code);
      renderLicenses();
    }
  });
}

function revokeLicenseAction(id) {
  const item = DB.licenses.find(l => l.id === id);
  if (!item) return;
  const reason = prompt('Nhập lý do thu hồi giấy phép:');
  if (reason === null) return;
  if (!reason.trim()) return alert('⛔ Vui lòng nhập lý do thu hồi!');
  showConfirmModal({
    title: 'Thu hồi giấy phép',
    bodyHTML: `Bạn có chắc chắn muốn THU HỒI giấy phép "<b>${escapeHtml(item.licenseType)}</b>" (${escapeHtml(item.displayCode || item.code)})?<br><span class="text-xs text-gray-500">Lý do: ${escapeHtml(reason.trim())}</span>`,
    confirmLabel: 'Thu Hồi',
    onConfirm: async () => {
      let updated;
      try {
        updated = (await callRecordAction('licenses', id, 'revoke', { reason: reason.trim() })).item;
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const idx = DB.licenses.findIndex(x => x.id === id);
      if (idx !== -1) DB.licenses[idx] = updated;
      logSystemAction('LICENSE', 'REVOKE_LICENSE', `Thu hồi giấy phép [${updated.code}] - Lý do: ${reason.trim()}`, 'WARNING', updated.code);
      renderLicenses();
    }
  });
}

function unrevokeLicenseAction(id) {
  const item = DB.licenses.find(l => l.id === id);
  if (!item) return;
  showConfirmModal({
    title: 'Bỏ thu hồi giấy phép',
    bodyHTML: `Bỏ trạng thái thu hồi cho giấy phép "<b>${escapeHtml(item.licenseType)}</b>" (${escapeHtml(item.displayCode || item.code)})?`,
    confirmLabel: 'Bỏ Thu Hồi',
    onConfirm: async () => {
      let updated;
      try {
        updated = (await callRecordAction('licenses', id, 'unrevoke', {})).item;
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const idx = DB.licenses.findIndex(x => x.id === id);
      if (idx !== -1) DB.licenses[idx] = updated;
      logSystemAction('LICENSE', 'UNREVOKE_LICENSE', `Bỏ thu hồi giấy phép [${updated.code}]`, 'SUCCESS', updated.code);
      renderLicenses();
    }
  });
}

function deleteLicenseAction(id) {
  const item = DB.licenses.find(l => l.id === id);
  if (!item) return;
  deleteRecordAdminOnly('licenses', id, `giấy phép ${item.displayCode || item.code}`, () => {
    DB.licenses = DB.licenses.filter(x => x.id !== id);
    logSystemAction('LICENSE', 'DELETE_LICENSE', `Xóa giấy phép [${item.code}]`, 'SUCCESS', item.code);
    renderLicenses();
  });
}

function downloadLicenseFile(id) {
  const item = DB.licenses.find(l => l.id === id);
  if (!item) return;
  const a = document.createElement('a');
  a.href = attachmentDownloadUrl(item.fileUrl, item.fileData, item.fileName || item.code);
  a.download = item.fileName || item.code;
  document.body.appendChild(a);
  a.click();
  a.remove();
  logSystemAction('LICENSE', 'DOWNLOAD_LICENSE', `Tải tệp giấy phép [${item.code}]`, 'SUCCESS', item.code);
}

function viewLicenseFile(id) {
  const item = DB.licenses.find(l => l.id === id);
  if (!item) return;
  openFileProtectedView({
    title: `📜 ${item.licenseType} (${item.displayCode || item.code})`,
    sub: `Công ty: ${item.companyName} | Địa điểm: ${item.locationName} | Số GP: ${item.licenseNumber}`,
    footerInfo: `Ngày cấp: ${item.issueDate} | Ngày hết hạn: ${item.expiryDate} | Cơ quan cấp: ${item.issuingAuthority}`,
    fileSrc: item.fileUrl, fileType: item.fileType, fileName: item.fileName
  });
}

function viewLicenseDetails(anyId) {
  const item = DB.licenses.find(l => l.id === anyId);
  if (!item) return;
  const family = getLicenseFamily(anyId);
  const root = family[0];

  const rowsHTML = family.map(v => {
    const finalApproval = [...(v.history || [])].reverse().find(h => h.action === 'APPROVED');
    let approverHTML;
    if (finalApproval) {
      approverHTML = `${escapeHtml(finalApproval.byName || finalApproval.by)}<div class="text-[10px] text-gray-400">${escapeHtml(finalApproval.time)}</div>`;
    } else if (v.status === 'REJECTED') {
      approverHTML = `<span class="text-red-600 font-semibold">Đã từ chối</span>`;
    } else {
      approverHTML = `<span class="text-gray-400 italic">Chưa duyệt</span>`;
    }
    const canDL = !!v.fileUrl && (currentUser.perms?.admin || currentUser.perms?.licenseApprove || currentUser.perms?.licenseView || v.creator === currentUser.username);
    return `
      <tr class="border-b hover:bg-gray-50">
        <td class="border p-2 text-center font-bold text-purple-700">v${v.versionNumber || 1}</td>
        <td class="border p-2">
          <div class="font-semibold text-gray-800">${escapeHtml(v.creatorName || v.creator)}</div>
          <div class="text-[10px] text-gray-400">${escapeHtml(v.createdAt || '')}</div>
        </td>
        <td class="border p-2">${approverHTML}</td>
        <td class="border p-2 text-gray-700">Số: ${escapeHtml(v.licenseNumber)}<br>${escapeHtml(v.issueDate)} → ${escapeHtml(v.expiryDate)}</td>
        <td class="border p-2 text-center whitespace-nowrap">
          <button type="button" data-op="viewLicenseFile" data-arg0="${v.id}" class="px-2 py-1 bg-blue-600 text-white rounded text-[11px] font-bold hover:bg-blue-700">👁️ Xem</button>
          ${canDL ? `<button type="button" data-op="downloadLicenseFile" data-arg0="${v.id}" class="px-2 py-1 bg-slate-600 text-white rounded text-[11px] font-bold hover:bg-slate-700 ml-1">⬇️ Tải</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  const historyHTML = (item.history || []).slice().reverse().map(h => `
    <div class="border-b py-1">
      <span class="font-semibold">${escapeHtml(h.action)}</span> bởi ${escapeHtml(h.byName || h.by)} — ${escapeHtml(h.time)}
      ${h.comment ? `<div class="text-gray-500 italic">${escapeHtml(h.comment)}</div>` : ''}
    </div>
  `).join('') || '<div class="text-gray-400 italic">Chưa có lịch sử.</div>';

  document.getElementById('licenseDetailTitle').innerText = `📜 Chi Tiết Giấy Phép: ${root.licenseType} (${root.displayCode || root.code})`;
  document.getElementById('licenseDetailBody').innerHTML = `
    <div class="grid grid-cols-2 gap-2 text-xs mb-3 bg-gray-50 p-2 rounded border">
      <div><b>Tên công ty chủ quản:</b> ${escapeHtml(root.companyName)}</div>
      <div><b>Tên địa điểm:</b> ${escapeHtml(root.locationName)}</div>
      <div><b>Tình trạng hoạt động:</b> ${item.operatingStatus === 'ACTIVE' ? 'Đang hoạt động' : 'Đã đóng cửa'}</div>
      <div><b>Cơ quan cấp phép:</b> ${escapeHtml(item.issuingAuthority)}</div>
    </div>
    <table class="w-full border-collapse border text-xs mb-3">
      <thead>
        <tr class="bg-gray-100 text-left">
          <th class="border p-2 text-center">Phiên Bản</th>
          <th class="border p-2">Người Tạo</th>
          <th class="border p-2">Người Phê Duyệt</th>
          <th class="border p-2">Số GP / Hạn</th>
          <th class="border p-2 text-center">Thao Tác</th>
        </tr>
      </thead>
      <tbody>${rowsHTML}</tbody>
    </table>
    <h4 class="font-bold text-gray-700 text-xs mb-1">📜 Lịch Sử Xử Lý (phiên bản đang xem: v${item.versionNumber || 1})</h4>
    <div class="bg-gray-50 p-2 rounded border text-[11px]">${historyHTML}</div>
  `;
  document.getElementById('licenseDetailModal').classList.remove('hidden');
}
function closeLicenseDetailModal() {
  document.getElementById('licenseDetailModal').classList.add('hidden');
}

async function uploadLicense(e) {
  e.preventDefault();
  const mode = document.getElementById('licenseOpMode').value;
  const companyName = document.getElementById('licenseCompanyName').value.trim();
  const locationName = document.getElementById('licenseLocationName').value.trim();
  const operatingStatus = document.getElementById('licenseOperatingStatus').value;
  const licenseType = document.getElementById('licenseType').value.trim();
  const licenseNumber = document.getElementById('licenseNumber').value.trim();
  const issueDate = document.getElementById('licenseIssueDate').value;
  const expiryDate = document.getElementById('licenseExpiryDate').value;
  const issuingAuthority = document.getElementById('licenseIssuingAuthority').value.trim();
  const fileInput = document.getElementById('licenseFile');

  let code, displayCode, versionNumber, rootLicenseId;
  if (mode === 'UPDATE') {
    const rootId = Number(document.getElementById('licenseUpdateTarget').value);
    const root = DB.licenses.find(l => l.id === rootId);
    if (!root) return alert('Vui lòng chọn giấy phép cần cập nhật!');
    const latest = getLicenseFamilyLatest(rootId);
    if (isLicenseFamilyLatestBlocking(latest)) {
      return alert('⛔ Không thể cập nhật khi phiên bản mới nhất của giấy phép này đang chờ duyệt!');
    }
    displayCode = root.displayCode || root.code;
    versionNumber = (latest.versionNumber || getLicenseFamily(rootId).length) + 1;
    code = `${displayCode}-V${versionNumber}`;
    rootLicenseId = rootId;
  } else {
    code = generateHcrcCode(DB.licenses, 'GP');
    displayCode = code;
    versionNumber = 1;
    rootLicenseId = null;
  }

  if (!companyName || !locationName || !licenseType || !licenseNumber || !issuingAuthority) {
    return alert('Vui lòng nhập đầy đủ thông tin!');
  }
  if (!issueDate || !expiryDate) return alert('Vui lòng nhập Ngày cấp và Ngày hết hạn!');
  if (new Date(expiryDate).getTime() < new Date(issueDate).getTime()) {
    return alert('Ngày hết hạn phải sau Ngày cấp!');
  }

  const file = fileInput.files[0];
  if (!file) return alert('Vui lòng chọn tệp giấy phép!');

  let uploaded;
  try {
    uploaded = await uploadFileToServer(file, 'license');
  } catch (err) {
    return alert(`⛔ Tải tệp lên thất bại: ${err.message}`);
  }

  // Tự học thêm vào Danh Mục "Các Loại Giấy Phép" (DB.licenseTypes) nếu là loại chưa từng gõ trước đây —
  // admin vẫn quản lý/dọn danh mục này riêng ở màn Quản Lý Danh Mục (xem saveLicenseType()/deleteLicenseType()).
  //
  // KHÔNG còn syncStorage('licenseTypes') ở đây: từ khi "licenseTypes" nằm trong ADMIN_ONLY_KEYS
  // (routes/data.js — danh mục này thuộc tab Quản Lý Danh Mục chỉ admin thấy, trước đây bất kỳ tài
  // khoản đã đăng nhập nào cũng GHI ĐÈ/XOÁ TRẮNG được cả danh mục qua POST /api/data/licenseTypes),
  // lượt ghi đè nguyên mảng đó đã đóng với người dùng thường. Việc LƯU chuyển hẳn về server, ở đúng
  // luồng tạo giấy phép và chỉ THÊM 1 giá trị (không sửa/xoá gì) — xem learnLicenseType() ở
  // routes/create.js. Dòng dưới chỉ cập nhật bản chụp TRONG BỘ NHỚ của tab hiện tại để ô gợi ý thấy
  // ngay giá trị vừa gõ mà không phải tải lại trang.
  if (licenseType && !(DB.licenseTypes || []).includes(licenseType)) {
    DB.licenseTypes = [...(DB.licenseTypes || []), licenseType];
  }

  const payload = {
    code, displayCode, versionNumber, rootLicenseId,
    companyName, locationName, operatingStatus, licenseType, licenseNumber,
    issueDate, expiryDate, issuingAuthority,
    fileName: uploaded.fileName, fileType: uploaded.fileType, fileUrl: uploaded.fileUrl,
    createdAt: new Date().toLocaleString('vi-VN')
  };

  let newItem;
  try {
    newItem = (await callCreateAction('licenses', payload)).item;
  } catch (err) {
    return alert('⛔ ' + err.message);
  }

  DB.licenses.unshift(newItem);
  logSystemAction('LICENSE', 'UPLOAD_LICENSE', `Tải lên giấy phép ${mode === 'UPDATE' ? 'phiên bản mới' : 'mới'} [${code} - ${licenseType}]`, 'SUCCESS', code);

  const approverUsernames = DB.moduleApproverUsernames?.licenseApprove || [];
  if (approverUsernames.length) {
    notifyUsersByEmail('LICENSE', 'NOTIFY_APPROVAL_NEEDED', code, approverUsernames,
      `[VPDT] Giấy phép ${code} cần bạn phê duyệt`,
      `Giấy phép "${licenseType}" (${code}) do ${currentUser.name} tải lên đang chờ bạn phê duyệt.`);
  }

  alert('✅ Tải lên và trình duyệt giấy phép thành công!');
  document.getElementById('licenseForm').reset();
  document.getElementById('licenseOpMode').value = 'NEW';
  onLicenseOpModeChange();
  renderLicenses();
}

// ============ Danh Mục "Các Loại Giấy Phép" (DB.licenseTypes) — cùng khuôn CRUD phẳng đơn giản với
// Danh Mục Siêu Thị (DB.stores) ở trên (không kiểm tra usage trước khi xóa) — nguồn gợi ý cho ô "Tên
// giấy phép / Loại giấy phép" (widget sdd, xem uploadLicense() tự học thêm giá trị mới gõ). ============
function saveLicenseType(e) {
  e.preventDefault();
  const name = document.getElementById('txtLicenseTypeName').value.trim();
  if (!name) return;
  if ((DB.licenseTypes || []).includes(name)) return alert('Loại giấy phép đã tồn tại!');
  DB.licenseTypes = [...(DB.licenseTypes || []), name];
  syncStorage('licenseTypes');
  logSystemAction('LICENSE', 'ADD_LICENSE_TYPE', `Thêm loại giấy phép mới [${name}]`, 'SUCCESS', name);
  document.getElementById('txtLicenseTypeName').value = '';
  renderLicenseTypeList();
}
function deleteLicenseType(name) {
  if (!confirm(`Xóa loại giấy phép "${name}" khỏi danh mục?`)) return;
  DB.licenseTypes = (DB.licenseTypes || []).filter(t => t !== name);
  syncStorage('licenseTypes');
  logSystemAction('LICENSE', 'DELETE_LICENSE_TYPE', `Xóa loại giấy phép [${name}]`, 'SUCCESS', name);
  renderLicenseTypeList();
}
function renderLicenseTypeList() {
  const ul = document.getElementById('licenseTypeList');
  if (!ul) return;
  ul.innerHTML = (DB.licenseTypes || []).map(t => `
    <li class="p-2 flex justify-between items-center gap-2 hover:bg-gray-50">
      <span class="flex-1">${escapeHtml(t)}</span>
      <button data-op="deleteLicenseType" data-arg0="${escapeHtml(t)}" class="text-red-500 font-bold hover:underline">Xóa</button>
    </li>
  `).join('');
}

// Tải 1 file lên server (POST /api/upload) — trả về { fileUrl, fileName, fileType, size }. moduleKey
// (vd 'doc', 'contract'...) cho server biết áp dụng đúng danh sách phần mở rộng cho phép của module
// nào (xem DB.uploadFileTypeConfig / admin "Loại Tệp Cho Phép") — bỏ trống thì dùng danh sách mặc định.
async function uploadFileToServer(file, moduleKey) {
  // Chặn sớm ở client nếu đã cấu hình giới hạn riêng cho module này — đỡ tốn công tải cả file lên rồi
  // mới bị server từ chối (server vẫn tự kiểm tra lại y hệt ở routes/upload.js, đây chỉ là trải nghiệm).
  if (moduleKey) {
    const maxMB = Number((DB.uploadSizeLimitConfig || {})[moduleKey]);
    if (maxMB > 0 && file.size > maxMB * 1024 * 1024) {
      throw new Error(`Tệp vượt quá dung lượng cho phép cho mục này (${maxMB}MB)`);
    }
  }
  const formData = new FormData();
  if (moduleKey) formData.append('module', moduleKey);
  formData.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
  return data;
}

// Ánh xạ modKey của FORM_TABS (dùng cho trường tùy chỉnh, chi tiết theo tab con) sang moduleKey của
// cấu hình "Loại Tệp Cho Phép" (theo module nghiệp vụ, xem uploadFileTypeConfig ở admin) — nhiều tab
// con của cùng 1 module nghiệp vụ (vd CONTRACT_APPROVAL/CONTRACT_MANAGE, hay 3 tab con Tổng Hợp) dùng
// chung 1 cấu hình loại tệp.
const UPLOAD_MODULE_KEY_MAP = {
  DOC: 'doc', SUBMISSION: 'submission', CONTRACT_APPROVAL: 'contract', CONTRACT_MANAGE: 'contract',
  MEETING_ROOM: 'meeting', MEETING_MINUTES: 'minutes', CAR: 'car',
  MUA_BAN: 'office', SUA_CHUA: 'office', INTERNAL_POST: 'internal'
};
function mapFormModKeyToUploadModule(modKey) {
  return UPLOAD_MODULE_KEY_MAP[modKey] || String(modKey || '').toLowerCase();
}

// applyUploadAcceptAttrs() CHUYỂN sang core.js (Hạ tầng: nạp module theo cụm, đợt 7) — finishLogin() gọi
// thẳng hàm này NGAY SAU đăng nhập, trước khi mở bất kỳ tab nào.

// Vũ trụ phần mở rộng khả dụng — PHẢI khớp ALLOWED_EXT ở routes/upload.js (đó mới là chặn thật, admin
// chỉ chọn ra 1 tập con của danh sách này cho từng module qua màn "Loại Tệp" bên dưới).
// Chỉ còn 3 định dạng phổ biến cho hồ sơ/tài liệu văn phòng — KHÔNG gồm Báo Cáo Định Kỳ (module đó đã
// bỏ hẳn hình thức nộp PowerPoint .pptx, chỉ còn PDF, nhưng chưa đưa vào màn cấu hình 3 định dạng này,
// luôn dùng nguyên ALLOWED_EXT mặc định phía server).
const UPLOAD_EXT_UNIVERSE = ['.pdf', '.docx', '.xlsx'];
// Ảnh minh hoạ câu hỏi (Ngân Hàng Câu Hỏi, Đào Tạo) — universe RIÊNG (chỉ ảnh), khác 8 module tài liệu
// văn phòng ở trên dùng chung UPLOAD_EXT_UNIVERSE — xem extUniverse per-module bên dưới.
const UPLOAD_EXT_UNIVERSE_IMAGE = ['.jpg', '.jpeg', '.png', '.webp'];
const UPLOAD_MODULE_LIST = [
  { key: 'doc', label: '📂 Tài Liệu' },
  { key: 'submission', label: '📜 Văn Bản Trình' },
  { key: 'contract', label: '📄 Hợp Đồng' },
  { key: 'car', label: '🚗 Đăng Ký Xe' },
  { key: 'meeting', label: '🏢 Phòng Họp' },
  { key: 'minutes', label: '📝 Biên Bản Họp' },
  { key: 'office', label: '🛒 Văn Phòng Tổng Hợp' },
  { key: 'internal', label: '📣 Truyền Thông Nội Bộ' },
  // extUniverse riêng (ảnh, không phải .pdf/.docx/.xlsx) — mọi module KHÔNG có field này dùng mặc định
  // chung UPLOAD_EXT_UNIVERSE (giữ nguyên hành vi 8 module ở trên).
  { key: 'trainingTestImage', label: '🧪 Ngân Hàng Câu Hỏi (Ảnh Minh Hoạ)', extUniverse: UPLOAD_EXT_UNIVERSE_IMAGE }
];

function renderUploadTypeConfig() {
  const container = document.getElementById('uploadTypeConfigList');
  const config = DB.uploadFileTypeConfig || {};
  const sizeConfig = DB.uploadSizeLimitConfig || {};
  container.innerHTML = UPLOAD_MODULE_LIST.map(m => {
    const extUniverse = m.extUniverse || UPLOAD_EXT_UNIVERSE;
    const allowed = Array.isArray(config[m.key]) && config[m.key].length ? config[m.key] : extUniverse;
    const checkboxesHTML = extUniverse.map(ext => `
      <label class="inline-flex items-center gap-1 mr-4 mb-1 text-xs">
        <input type="checkbox" data-op-change="toggleUploadTypeExtFromCheckbox" data-arg0="${m.key}" data-arg1="${ext}" data-arg-el="2" ${allowed.includes(ext) ? 'checked' : ''}>
        ${ext}
      </label>`).join('');
    const currentSize = Number(sizeConfig[m.key]) > 0 ? Number(sizeConfig[m.key]) : '';
    return `
      <div class="bg-white p-3 rounded border">
        <div class="font-bold text-sm text-gray-800 mb-2">${m.label}</div>
        <div class="flex flex-wrap mb-2">${checkboxesHTML}</div>
        <div class="flex items-center gap-2 text-xs">
          <label class="text-gray-600">Giới hạn dung lượng riêng (MB):</label>
          <input type="number" min="1" step="1" placeholder="Mặc định chung" value="${currentSize}"
            data-op-change="updateUploadSizeLimit" data-arg0="${m.key}" data-arg-value="1" class="w-28 border p-1 rounded">
        </div>
      </div>`;
  }).join('');
}

// Tự lưu ngay khi đổi ô giới hạn dung lượng (cùng khuôn toggleUploadTypeExt() ngay trên) — để trống
// (hoặc xoá về 0/số âm) coi như KHÔNG giới hạn riêng, quay về đúng giới hạn CHUNG toàn hệ thống (env
// UPLOAD_MAX_MB, xem routes/upload.js).
function updateUploadSizeLimit(moduleKey, rawValue) {
  const value = Number(rawValue);
  if (!DB.uploadSizeLimitConfig) DB.uploadSizeLimitConfig = {};
  if (value > 0) DB.uploadSizeLimitConfig[moduleKey] = value;
  else delete DB.uploadSizeLimitConfig[moduleKey];
  syncStorage('uploadSizeLimitConfig');
  logSystemAction('ADMIN', 'UPDATE_UPLOAD_SIZE_LIMIT', `Cập nhật giới hạn dung lượng tệp [${moduleKey}]: ${value > 0 ? value + 'MB' : 'dùng mặc định chung'}`, 'SUCCESS');
}

// Tự lưu ngay khi tick/bỏ tick 1 định dạng (cùng khuôn updateDeptAbbr()/updateContractTypeAbbr() —
// không cần nút Lưu riêng). Danh sách rỗng sau khi bỏ hết tick vẫn được lưu (routes/upload.js coi
// mảng rỗng như "chưa cấu hình", tự rơi về danh sách mặc định — không khoá cứng module về 0 định dạng).
function toggleUploadTypeExt(moduleKey, ext, checked) {
  if (!DB.uploadFileTypeConfig) DB.uploadFileTypeConfig = {};
  const moduleDef = UPLOAD_MODULE_LIST.find(m => m.key === moduleKey);
  const extUniverse = moduleDef?.extUniverse || UPLOAD_EXT_UNIVERSE;
  const current = Array.isArray(DB.uploadFileTypeConfig[moduleKey]) && DB.uploadFileTypeConfig[moduleKey].length
    ? DB.uploadFileTypeConfig[moduleKey] : extUniverse.slice();
  DB.uploadFileTypeConfig[moduleKey] = checked ? [...new Set([...current, ext])] : current.filter(e => e !== ext);
  syncStorage('uploadFileTypeConfig');
  applyUploadAcceptAttrs();
  logSystemAction('ADMIN', 'UPDATE_UPLOAD_TYPE_CONFIG', `Cập nhật loại tệp cho phép [${moduleKey}]: ${checked ? 'thêm' : 'bỏ'} ${ext}`, 'SUCCESS');
}
// CSP: onchange checkbox chỉ truyền được phần tử qua data-arg-el (không có slot "this.checked" — xem
// cspReadArgSlot), nên tách riêng wrapper đọc .checked từ phần tử rồi mới gọi hàm lõi ở trên.
function toggleUploadTypeExtFromCheckbox(moduleKey, ext, checkboxEl) {
  toggleUploadTypeExt(moduleKey, ext, checkboxEl.checked);
}

// CẬP NHẬT: Phê duyệt cấp đơn đơn giản hóa (Sequential Step Approval)
// Xác thực lại (mật khẩu/OTP/PIN) trước khi Duyệt (perms.approverAuthLevel) — trước đây chỉ 3/7 module
// dùng chung engine phê duyệt (Văn bản trình/Xe/Văn phòng) gọi withApprovalAuth(), khiến người dùng
// tưởng cấu hình này áp dụng cho MỌI lượt duyệt của mình nhưng Tài Liệu/Hợp Đồng/VPP lại không được
// bảo vệ. Nay áp cho cả 7 module (khớp routes/workflow.js APPROVAL_REAUTH_MODULES đã mở rộng).
function approveDoc(docId) {
  withApprovalAuth(() => approveDocConfirmed(docId));
}
async function approveDocConfirmed(docId) {
  const doc = DB.docs.find(d => d.id === docId);
  if (!doc) return;

  let result;
  try {
    result = await callWorkflowAction('docs', docId, 'approve', {});
  } catch (e) {
    return alert('⛔ ' + e.message);
  }

  const updatedDoc = result.item;
  const transition = result.transition;
  const idx = DB.docs.findIndex(d => d.id === docId);
  if (idx !== -1) DB.docs[idx] = updatedDoc;

  let msg = '✅ Đã ghi nhận phê duyệt của bạn!';
  if (transition.type === 'COMPLETED') {
    msg = '✅ Phê duyệt tài liệu thành công!';
    notifyUsersByEmail('DOC', 'NOTIFY_APPROVED', updatedDoc.code, [updatedDoc.uploader],
      `[VPDT] Tài liệu ${updatedDoc.code} đã được phê duyệt`,
      `Tài liệu "${updatedDoc.title}" (${updatedDoc.code}) của bạn đã được phê duyệt hoàn tất.`);
  } else if (transition.type === 'ADVANCED') {
    msg = getStepAdvanceMessage(transition.stepApprovers);
    if (transition.nextApprovers.length) {
      notifyUsersByEmail('DOC', 'NOTIFY_APPROVAL_NEEDED', updatedDoc.code, transition.nextApprovers,
        `[VPDT] Tài liệu ${updatedDoc.code} cần bạn phê duyệt`,
        `Tài liệu "${updatedDoc.title}" (${updatedDoc.code}) đang chờ bạn phê duyệt ở bước "${transition.nextStepName}".`);
    }
  } else if (transition.type === 'PARTIAL_APPROVE') {
    msg = '✅ Đã ghi nhận phê duyệt của bạn — đang chờ các đồng phê duyệt còn lại ở bước này.';
  }

  logSystemAction('DOC', 'APPROVE_DOC', `Phê duyệt tài liệu [${updatedDoc.code}] thành công.`, 'SUCCESS', updatedDoc.code);
  alert(msg);
  renderDocs();
  refreshApprovalSurfaces();
}

async function rejectDoc(docId) {
  const doc = DB.docs.find(d => d.id === docId);
  if (!doc) return;

  const reason = prompt('Nhập lý do từ chối / trả về tài liệu:');
  if (reason === null) return;

  let result;
  try {
    result = await callWorkflowAction('docs', docId, 'reject', { comment: reason });
  } catch (e) {
    return alert('⛔ ' + e.message);
  }

  const updatedDoc = result.item;
  const idx = DB.docs.findIndex(d => d.id === docId);
  if (idx !== -1) DB.docs[idx] = updatedDoc;

  logSystemAction('DOC', 'REJECT_DOC', `Từ chối tài liệu [${updatedDoc.code}]. Lý do: ${reason}`, 'SUCCESS', updatedDoc.code);
  notifyUsersByEmail('DOC', 'NOTIFY_REJECTED', updatedDoc.code, [updatedDoc.uploader],
    `[VPDT] Tài liệu ${updatedDoc.code} bị từ chối`,
    `Tài liệu "${updatedDoc.title}" (${updatedDoc.code}) của bạn đã bị từ chối/trả về. Lý do: ${reason}`);
  alert('❌ Đã chuyển tài liệu sang trạng thái Từ chối / Trả về!');
  renderDocs();
  refreshApprovalSurfaces();
}

// Xác định loại tệp (ảnh / pdf / word / excel / văn phòng khác / khác) dựa trên fileType (MIME) và
// phần mở rộng tên tệp. "word"/"excel" CHỈ áp dụng cho định dạng mới .docx/.xlsx (dạng nén zip+XML) —
// mammoth.js/exceljs (xem renderWordProtected()/renderExcelProtected() ở script cuối trang) chỉ đọc
// được 2 định dạng này. File .doc/.xls đời cũ (nhị phân, không phải zip) và .ppt/.pptx (chưa có thư
// viện JS nào render tốt trong trình duyệt) vẫn rơi về "office" — khung "chưa hỗ trợ xem trực tuyến,
// vui lòng Tải về" như trước.
function getFileKind(fileType, fileName) {
  const t = (fileType || '').toLowerCase();
  const ext = (fileName || '').toLowerCase().split('.').pop();
  if (t.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'image';
  if (t === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'word';
  if (ext === 'xlsx') return 'excel';
  if (['doc', 'xls', 'ppt', 'pptx'].includes(ext)) return 'office';
  return 'other';
}

// Chữ watermark DUY NHẤT hiển thị khi xem tệp đính kèm qua Protected View (áp dụng cho MỌI tệp — Tài
// liệu, Hợp đồng, Văn bản trình, Xe, Văn phòng, Biên bản...) — 1 dòng, đặt cố định ở góc dưới-trái mỗi
// trang/khung xem, cỡ chữ nhỏ (~13px), KHÔNG kèm tên người xem (trước đây có dòng "PROTECTED VIEW - tên
// người xem" phía trên, đã bỏ theo yêu cầu chỉ giữ đúng 1 dòng tên hệ thống).
const PROTECTED_VIEW_WATERMARK_COMPANY = 'Hệ thống văn phòng số Công ty HCRC';
// Style dùng chung cho mọi nơi vẽ watermark ở góc dưới-trái (Protected View) — cỡ chữ vừa (13px), màu
// xám nhạt không chói mắt nhưng vẫn đủ rõ để nhận diện, không chặn thao tác/không chọn được text.
const PROTECTED_VIEW_WATERMARK_STYLE = 'position:absolute;left:10px;bottom:6px;font-size:13px;font-weight:600;color:rgba(110,110,110,0.55);white-space:nowrap;pointer-events:none;user-select:none;z-index:5;';

// Trả về URL TẢI THẬT cho 1 tệp đính kèm — khác fileUrl thô dùng để XEM (openFileProtectedView/mammoth/
// exceljs vẫn fetch thẳng /uploads/... như cũ, không qua đây, để giữ tốc độ xem không tốn thêm xử lý
// server). Mọi lượt TẢI (nút "⬇️ Tải"/action-dropdown "download") phải qua route dùng chung này —
// server tự đóng dấu watermark nếu là PDF, còn lại (Word/Excel/ảnh...) trả nguyên vẹn (xem
// routes/download.js). Bản ghi CŨ còn base64 nhúng sẵn (fileData, không có fileUrl trên server) không
// có đường đi qua server nên vẫn tải thẳng như trước — không có watermark (giới hạn đã biết với số ít
// bản ghi cũ còn sót lại từ trước khi chuyển sang lưu file vật lý).
function attachmentDownloadUrl(fileUrl, fileData, fileName) {
  if (fileUrl && fileUrl.startsWith('/uploads/')) {
    return `/api/files/download?fileUrl=${encodeURIComponent(fileUrl)}&name=${encodeURIComponent(fileName || '')}`;
  }
  return fileUrl || fileData;
}

// Dựng HTML khung xem Protected View cho 1 tệp — dùng cho ảnh / định dạng văn phòng / khác. PDF
// KHÔNG còn đi qua hàm này (xem openFileProtectedView + renderPdfProtected ở script type="module"
// cuối trang) — PDF được vẽ ra <canvas> bằng PDF.js thay vì plugin PDF gốc của trình duyệt, vì plugin
// gốc (qua <object>/<iframe>) bị Chrome/Edge chặn khi nằm trong modal có lớp nền mờ ("PDF bị che bởi
// phần tử khác"), và không thể ẩn thanh công cụ In/Tải có sẵn của plugin bằng JavaScript của trang.
// Trả về null nếu không có tệp (để nơi gọi tự hiển thị nội dung tóm tắt thay thế).
function buildProtectedViewerHTML(fileSrc, fileType, fileName, altLabel) {
  if (!fileSrc) return null;
  const kind = getFileKind(fileType, fileName);

  if (kind === 'image') {
    // Watermark đè lên ảnh ở góc dưới-trái — trước đây nhánh ảnh KHÔNG có watermark, là lỗ hổng vì ảnh
    // scan (hợp đồng/giấy phép chụp ảnh...) xem được nguyên vẹn không dấu vết nếu chụp lại màn hình.
    return `
      <div class="relative flex flex-col items-center justify-center p-4 w-full protected-view-container" oncontextmenu="return false;">
        <img src="${fileSrc}" alt="${escapeHtml(altLabel || '')}" class="max-h-[65vh] max-w-full rounded border shadow-md object-contain pointer-events-none select-none" oncontextmenu="return false;" />
        <div style="${PROTECTED_VIEW_WATERMARK_STYLE}">${escapeHtml(PROTECTED_VIEW_WATERMARK_COMPANY)}</div>
      </div>
    `;
  }

  const kindLabel = kind === 'office' ? 'Định dạng này (Word/Excel đời cũ .doc/.xls, hoặc PowerPoint)' : 'Định dạng tệp này';
  return `
    <div class="w-full h-[65vh] bg-white rounded border shadow-inner flex flex-col items-center justify-center gap-2 p-6 text-center protected-view-container" oncontextmenu="return false;">
      <div class="text-5xl">📎</div>
      <div class="font-bold text-gray-700">${escapeHtml(fileName || 'Tệp đính kèm')}</div>
      <div class="text-xs text-gray-500 max-w-sm">${kindLabel} chưa hỗ trợ xem trực tuyến ngay trong trình duyệt. Vui lòng dùng nút "⬇️ Tải" để tải về và mở bằng phần mềm tương ứng.</div>
    </div>
  `;
}

// Mở #viewDocModal để xem 1 tệp đính kèm THẬT (khác với Phiếu/chứng từ do hệ thống tự dựng — những
// Phiếu đó gọi thẳng viewModalContent.innerHTML nên KHÔNG qua hàm này và vẫn giữ nút In). Dùng chung
// cho mọi module có tệp đính kèm (Tài liệu, Hợp đồng, Văn bản trình, Đăng ký xe, Văn phòng...). Theo
// đúng chính sách mới: PDF luôn ẩn nút In (vẽ bằng PDF.js ra canvas, không có thao tác in/tải nào từ
// khung xem); các loại tệp khác (ảnh, văn phòng...) cũng ẩn nút In vì đây là khung xem tệp đính kèm
// thô, không phải chứng từ được thiết kế để in — nút In chỉ dành cho Phiếu hệ thống tự tạo.
// pdfProgress (tuỳ chọn, Đào Tạo > PDF phải xem hết mới tính hoàn thành — xem viewTrainingPdfDoc() ở
// module-internalcomms-daotao.js): { initialViewedPages, onPageViewed } chuyển thẳng cho
// renderPdfProtected() (tham số thứ 4, xem chú thích ở đó) — MỌI caller khác không truyền field này nên
// hành vi giữ NGUYÊN VẸN như trước (undefined).
function openFileProtectedView({ title, sub, footerInfo, fileSrc, fileType, fileName, noFileFallbackHTML, pdfProgress }) {
  document.getElementById('viewModalTitle').innerText = title;
  document.getElementById('viewModalSub').innerText = sub || '';
  document.getElementById('viewModalFooterInfo').innerText = footerInfo || '';
  document.getElementById('viewModalPrintBtn').classList.add('hidden');
  document.getElementById('viewModalWordPrintBtn').classList.add('hidden');

  const container = document.getElementById('viewModalContent');
  const kind = fileSrc ? getFileKind(fileType, fileName) : null;

  if (kind === 'pdf') {
    container.innerHTML = `<div class="w-full h-[65vh] overflow-y-auto bg-gray-200 rounded protected-view-container" oncontextmenu="return false;"></div>`;
    const pdfContainer = container.firstElementChild;
    document.getElementById('viewDocModal').classList.remove('hidden');
    if (window.renderPdfProtected) {
      window.renderPdfProtected(pdfContainer, fileSrc, PROTECTED_VIEW_WATERMARK_COMPANY, pdfProgress);
    } else {
      pdfContainer.innerHTML = '<div class="p-6 text-center text-gray-500 text-sm">⏳ Đang tải bộ xem PDF...</div>';
    }
    return;
  }

  // Word (.docx)/Excel (.xlsx) — xem trực tiếp trong trình duyệt qua mammoth.js/exceljs (xem
  // renderWordProtected()/renderExcelProtected() ở script cuối trang), cùng cơ chế tải thư viện + hiện
  // trạng thái "Đang tải..." như nhánh PDF ở trên (khác biệt: PDF.js đã tải sẵn lúc mở trang vì dùng
  // type="module" import tĩnh, còn mammoth/exceljs tải LÚC CẦN qua loadVendorScript() vì khá nặng, đa
  // số tệp đính kèm KHÔNG phải Word/Excel nên không đáng tải sẵn cho mọi người).
  if (kind === 'word' || kind === 'excel') {
    container.innerHTML = `<div class="w-full h-[65vh] overflow-y-auto bg-gray-100 rounded protected-view-container" oncontextmenu="return false;"></div>`;
    const officeContainer = container.firstElementChild;
    document.getElementById('viewDocModal').classList.remove('hidden');
    if (kind === 'word') {
      // "In có watermark" — CHỈ áp dụng được cho .docx (mammoth chỉ đọc được định dạng OOXML/zip mới,
      // KHÔNG đọc được .doc nhị phân đời cũ) — xem printWordWithWatermark() ở script cuối trang.
      currentWordPrintFile = { fileSrc, fileName };
      document.getElementById('viewModalWordPrintBtn').classList.remove('hidden');
    }
    // renderWordProtected()/renderExcelProtected() dinh nghia trong module-internalcomms-daotao-viewer.js
    // (cum rieng "internalcomms-daotao-viewer", nap LUOI) - truoc day chi kiem tra window.renderXProtected
    // co san hay chua (khong throw vi la truy cap thuoc tinh, nhung neu chua co thi ket qua la 1 dong chu
    // "Dang tai..." dung yen MAI MAI, khong co gi kich lai) — gio dung ensureFnReady() (Ha tang: nap module
    // theo cum, dot 7) de CHU DONG nap dung cum roi goi lai, khong con phu thuoc may rui thu tu nap file.
    const fnName = kind === 'word' ? 'renderWordProtected' : 'renderExcelProtected';
    if (typeof window[fnName] === 'function') {
      window[fnName](officeContainer, fileSrc);
    } else {
      officeContainer.innerHTML = '<div class="p-6 text-center text-gray-500 text-sm">⏳ Đang tải bộ xem...</div>';
      ensureFnReady(fnName).then(() => {
        window[fnName](officeContainer, fileSrc);
      }).catch(err => {
        officeContainer.innerHTML = `<div class="p-6 text-center text-red-600 text-sm">⛔ Không tải được bộ xem: ${escapeHtml(err.message)}</div>`;
      });
    }
    return;
  }

  const viewerHTML = fileSrc ? buildProtectedViewerHTML(fileSrc, fileType, fileName, title) : null;
  container.innerHTML = viewerHTML || noFileFallbackHTML || `
    <div class="w-full h-[60vh] bg-white p-6 rounded shadow border flex items-center justify-center text-gray-400 italic protected-view-container" oncontextmenu="return false;">
      Không có tệp đính kèm để xem trước.
    </div>
  `;
  document.getElementById('viewDocModal').classList.remove('hidden');
}

function viewDoc(docId) {
  const doc = DB.docs.find(d => d.id === docId);
  if (!doc) return;
  // fileUrl: file lưu trên server (mới). fileData: fallback cho bản ghi cũ còn base64 nhúng sẵn trong DB.
  const fileSrc = doc.fileUrl || doc.fileData;

  openFileProtectedView({
    title: `📄 ${doc.title} (${doc.code})`,
    sub: `Phòng ban: ${doc.dept} | Phân loại: ${doc.cat} | Phiên bản: ${doc.ver} | Người trình: ${doc.uploaderName || doc.uploader}`,
    footerInfo: `Trích lục: ${doc.summary || 'Không có mô tả'}`,
    fileSrc, fileType: doc.fileType, fileName: doc.fileName,
    noFileFallbackHTML: `
      <div class="w-full h-[60vh] bg-white p-6 rounded shadow border overflow-y-auto relative protected-view-container" oncontextmenu="return false;">
        <div style="${PROTECTED_VIEW_WATERMARK_STYLE}">${escapeHtml(PROTECTED_VIEW_WATERMARK_COMPANY)}</div>
        <h4 class="font-bold text-lg text-gray-800 border-b pb-2 mb-4">${escapeHtml(doc.title)} (${escapeHtml(doc.code)})</h4>
        <div class="text-sm text-gray-700 space-y-3">
          <p><b>Phòng ban:</b> ${escapeHtml(doc.dept)}</p>
          <p><b>Loại tài liệu:</b> ${escapeHtml(doc.cat)}</p>
          <p><b>Phiên bản:</b> ${escapeHtml(doc.ver)}</p>
          <p><b>Trích yếu nội dung:</b></p>
          <div class="bg-gray-50 p-4 rounded border text-gray-800 italic">
            ${escapeHtml(doc.summary || 'Không có mô tả chi tiết.')}
          </div>
        </div>
      </div>
    `
  });
}

function closeViewDocModal() {
  document.getElementById('viewDocModal').classList.add('hidden');
  document.getElementById('viewModalContent').innerHTML = '';
  document.getElementById('viewModalPrintBtn').classList.remove('hidden');
}

// Modal "Chi Tiết Tài Liệu" — liệt kê TOÀN BỘ phiên bản của 1 tài liệu (gốc + version con), người tải
// lên/người phê duyệt cuối/mô tả từng phiên bản. "Người phê duyệt" lấy từ bản ghi APPROVED gần nhất
// trong lịch sử xử lý của ĐÚNG phiên bản đó (mỗi phiên bản có quy trình duyệt độc lập).
function viewDocDetails(anyDocId) {
  const doc = DB.docs.find(d => d.id === anyDocId);
  if (!doc) return;
  const family = getDocFamily(anyDocId);
  const rootDoc = family[0];

  const rowsHTML = family.map(v => {
    const finalApproval = [...(v.history || [])].reverse().find(h => h.action === 'APPROVED');
    let approverHTML;
    if (finalApproval) {
      approverHTML = `${escapeHtml(finalApproval.approver)}<div class="text-[10px] text-gray-400">${escapeHtml(finalApproval.time)}</div>`;
    } else if (v.status === 'REJECTED') {
      approverHTML = `<span class="text-red-600 font-semibold">Đã từ chối</span>`;
    } else {
      approverHTML = `<span class="text-gray-400 italic">Chưa duyệt</span>`;
    }
    const canDL = (v.fileUrl || v.fileData) && canDownloadFile(currentUser, 'doc', v.dept, v.uploader);
    // Trước đây customData (trường tuỳ biến bắt buộc nhập lúc upload — collectDynamicFieldsData('DOC'),
    // validateRequiredCustomData ở server) không hiển thị lại ở bất kỳ đâu của module Tài Liệu, khác
    // Văn Bản Trình/Hợp Đồng/Văn Phòng Tổng Hợp đều hiện đúng trong Chi Tiết — dữ liệu coi như bị "nuốt"
    // sau khi lưu. Mỗi PHIÊN BẢN có customData riêng (thu thập lại mỗi lần tải lên) nên hiện theo dòng.
    const customDataHTML = (v.customData && Object.keys(v.customData).length > 0)
      ? `<div class="mt-1 text-[10px] text-gray-500 space-y-0.5">${Object.keys(v.customData).map(k => `<div><b>${escapeHtml(k)}:</b> ${escapeHtml(String(v.customData[k]))}</div>`).join('')}</div>`
      : '';

    return `
      <tr class="border-b hover:bg-gray-50">
        <td class="border p-2 text-center font-bold text-purple-700">${escapeHtml(v.ver)}</td>
        <td class="border p-2">
          <div class="font-semibold text-gray-800">${escapeHtml(v.uploaderName || v.uploader)}</div>
          <div class="text-[10px] text-gray-400">${escapeHtml(v.createdAt || '')}</div>
        </td>
        <td class="border p-2">${approverHTML}</td>
        <td class="border p-2 text-gray-700">${escapeHtml(v.summary || '')}${customDataHTML}</td>
        <td class="border p-2 text-center whitespace-nowrap">
          <button type="button" data-op="viewDoc" data-arg0="${v.id}" class="px-2 py-1 bg-blue-600 text-white rounded text-[11px] font-bold hover:bg-blue-700">👁️ Xem</button>
          ${canDL ? `<button type="button" data-op="downloadDocFile" data-arg0="${v.id}" class="px-2 py-1 bg-slate-600 text-white rounded text-[11px] font-bold hover:bg-slate-700 ml-1">⬇️ Tải</button>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  document.getElementById('docDetailTitle').innerText = `📋 Chi Tiết Tài Liệu: ${rootDoc.title} (${rootDoc.displayCode || rootDoc.code})`;
  document.getElementById('docDetailBody').innerHTML = `
    <div class="grid grid-cols-2 gap-2 text-xs mb-3 bg-gray-50 p-2 rounded border">
      <div><b>Phòng ban:</b> ${escapeHtml(rootDoc.dept)}</div>
      <div><b>Phân loại:</b> ${escapeHtml(rootDoc.cat)}</div>
    </div>
    <table class="w-full border-collapse border text-xs">
      <thead>
        <tr class="bg-gray-100 text-left">
          <th class="border p-2 text-center">Phiên Bản</th>
          <th class="border p-2">Người Tải Lên</th>
          <th class="border p-2">Người Phê Duyệt</th>
          <th class="border p-2">Mô Tả</th>
          <th class="border p-2 text-center">Thao Tác</th>
        </tr>
      </thead>
      <tbody>${rowsHTML}</tbody>
    </table>
  `;
  document.getElementById('docDetailModal').classList.remove('hidden');
}

function closeDocDetailModal() {
  document.getElementById('docDetailModal').classList.add('hidden');
}

// In trực tiếp nội dung đang hiển thị trong Protected Viewer (tệp đính kèm hoặc phiếu/chứng từ
// dựng động như Phiếu Phê Duyệt Đăng Ký Xe) — dùng 1 iframe ẩn để chỉ in đúng phần nội dung, không
// in kèm khung modal/nút bấm xung quanh.
function printViewModalContent() {
  const container = document.getElementById('viewModalContent');
  if (!container || !container.innerHTML.trim()) return alert('Không có nội dung để in.');
  printHtmlViaHiddenIframe(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>In</title></head><body>${container.innerHTML}</body></html>`);
}

// In qua iframe ẩn (KHÔNG thêm thư viện tạo PDF nào — người dùng chọn "Save as PDF" ở hộp thoại In của
// trình duyệt). QUAN TRỌNG: gọi print() NGAY SAU doc.close(), KHÔNG chờ sự kiện "load" của iframe — nội
// dung ghi bằng document.write()/close() đã có sẵn NGAY LÚC close() trả về (đồng bộ), trong khi "load"
// của 1 iframe rỗng thường bắn ra NGAY LÚC appendChild (trước khi kịp gán onload ở dưới) nên callback
// gán SAU dễ không bao giờ chạy — bấm nút không thấy gì cả, không báo lỗi (bug thật đã gặp ở nút "Tải
// PDF" Báo Cáo Định Kỳ, cùng 1 khuôn mẫu này bị sao chép qua nên sửa chung ở đây).
function printHtmlViaHiddenIframe(html) {
  const printFrame = document.createElement('iframe');
  printFrame.style.position = 'fixed';
  printFrame.style.right = '0';
  printFrame.style.bottom = '0';
  printFrame.style.width = '0';
  printFrame.style.height = '0';
  printFrame.style.border = '0';
  document.body.appendChild(printFrame);

  const doc = printFrame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  printFrame.contentWindow.focus();
  printFrame.contentWindow.print();
  setTimeout(() => document.body.removeChild(printFrame), 1000);
}

