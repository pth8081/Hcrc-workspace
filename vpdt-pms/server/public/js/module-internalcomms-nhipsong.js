// ==========================================
// TRUYỀN THÔNG NỘI BỘ (Nhịp Sống HCRC / Đào tạo / Khen thưởng / Góc chia sẻ)
// ==========================================
// Kênh thông tin nội bộ tương tác đầy đủ: bình luận, thả tim (like) và ghi nhận người đã xem cho
// từng bài đăng — dùng chung 1 collection DB.internalPosts, phân biệt bằng field `type`. XEM và
// tương tác mở cho mọi người dùng (không lọc theo phạm vi phòng ban) vì đây là kênh truyền thông
// toàn công ty; chỉ việc ĐĂNG BÀI ở Nhịp Sống HCRC/Đào tạo/Khen thưởng mới cần quyền riêng.

function setInternalSubTab(subTab) {
  window.scrollTo({ top: 0, behavior: 'auto' }); // Tránh "bay xuống cuối" khi đổi tab con — xem setSystemSubTab().
  resetListPage('internal');
  resetListPage('internalNews');
  // Mục 0 (10/2026): gác CỨNG theo checkbox "0. Quyền Truy Cập Module" riêng của từng tab (xem
  // canAccessInternalSubTab(), core.js) — nếu tab đang xin mở đã bị admin tắt, tự chuyển sang tab con
  // ĐẦU TIÊN còn thấy được thay vì chặn cứng bằng alert (các tab này mặc định mở cho mọi người, không có
  // "màn chặn truy cập" quen thuộc như module khác, nên im lặng điều hướng là trải nghiệm hợp lý hơn).
  subTab = resolveAccessibleInternalSubTab(currentUser, subTab);
  activeInternalSubTab = subTab;

  // Vá lỗi "tab không có Dashboard vẫn thấy Dashboard cũ" (Đợt E, 9/2026): trước đây #internalDashboardCards
  // chỉ được xoá/dựng lại BÊN TRONG renderInternalPosts()/renderInternalFeedStyle() — nhưng NEWS/TRAINING/
  // RECRUITMENT/QNA đều return SỚM (usesOwnSection hoặc nhánh riêng) TRƯỚC KHI chạm tới đoạn dọn dashboard
  // đó, nên đổi từ Góc Chia Sẻ (có dashboard) sang tab khác vẫn thấy 4 thẻ dashboard cũ còn sót lại trên
  // màn hình — trông như tab đó "có Dashboard" dù thiết kế không có, gây hiểu lầm là bug. Dọn NGAY TẠI ĐÂY,
  // chạy TRƯỚC mọi nhánh return sớm bên dưới, đảm bảo luôn đúng bất kể tab kế tiếp là gì; renderInternalFeedStyle('SHARE')
  // sẽ tự dựng lại dashboard ngay sau đó nếu tab mới đúng là Góc Chia Sẻ.
  document.getElementById('internalDashboardCards')?.replaceChildren();

  // Đổi tab con luôn thoát chế độ Sửa (nếu có) — form trắng, quay lại chế độ Đăng bài mới. Cùng khuôn
  // cancelEditCustomField() ở Biểu Mẫu (đổi tab = huỷ dở dang thao tác Sửa đang mở).
  editingInternalPostId = null;
  document.getElementById('internalCancelEditBtn')?.classList.add('hidden');

  const btnMap = { NEWS: 'btnInternalSubNews', TRAINING: 'btnInternalSubTraining', RECRUITMENT: 'btnInternalSubRecruitment', SHARE: 'btnInternalSubShare', QNA: 'btnInternalSubQna' };
  Object.entries(btnMap).forEach(([type, btnId]) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const cls = type === subTab ? 'px-3 py-1 rounded text-xs font-bold bg-fuchsia-700 text-white' : 'px-3 py-1 rounded text-xs font-bold bg-gray-200 text-gray-700';
    btn.className = cls + (canAccessInternalSubTab(currentUser, type) ? '' : ' hidden');
  });

  // "Đào tạo" (tạm thời) — thay hẳn khung đăng bài đơn giản cũ bằng LMS thu gọn (Lớp Học/Đăng Ký Của
  // Tôi/Kho Tài Liệu/Lộ Trình Thăng Tiến), ẩn toàn bộ khung đăng bài + tìm kiếm + danh sách kiểu cũ.
  // 3 tab dùng KHỐI RIÊNG (không dùng khung đăng bài/tìm kiếm/danh sách bài viết chung): Đào Tạo,
  // Tuyển Dụng và HCRC Đồng Hành (hộp thư hỏi/đáp riêng tư với Nhân Sự).
  const usesOwnSection = subTab === 'TRAINING' || subTab === 'RECRUITMENT' || subTab === 'QNA';
  document.getElementById('internalTrainingLmsSection').classList.toggle('hidden', subTab !== 'TRAINING');
  document.getElementById('internalPostForm').classList.toggle('hidden', usesOwnSection);
  document.getElementById('internalNoPermNote').classList.add('hidden');
  document.getElementById('internalFilterBlock').classList.toggle('hidden', usesOwnSection);
  document.getElementById('internalListBlock').classList.toggle('hidden', usesOwnSection);
  if (subTab === 'TRAINING') {
    renderTrainingLms();
    return;
  }

  // "Tuyển dụng" (thay "Khen thưởng" cũ) — cũng là khối riêng như Đào tạo, không dùng khung đăng bài
  // chung (đăng tin/giới thiệu ứng viên đi qua form + modal riêng, xem renderRecruitment()).
  document.getElementById('internalRecruitmentSection').classList.toggle('hidden', subTab !== 'RECRUITMENT');
  if (subTab === 'RECRUITMENT') {
    renderRecruitment();
    return;
  }

  // "HCRC Đồng Hành" — cũng là khối riêng như Đào tạo/Tuyển dụng. PHẢI return sớm ở đây (trước phần
  // pin-field/chuyên đề/nhãn form bên dưới) vì toàn bộ logic còn lại giả định chỉ còn NEWS/SHARE.
  document.getElementById('internalQnaSection').classList.toggle('hidden', subTab !== 'QNA');
  if (subTab === 'QNA') {
    renderDynamicInputsForModule('HR_FEEDBACK', 'dynamicFieldsContainer_HR_FEEDBACK');
    renderHrFeedbackInbox();
    return;
  }

  // Ghim lên trang chủ (Đợt E) — không áp dụng Góc chia sẻ (còn phải qua duyệt mới công khai), chỉ
  // người có quyền internalPostApprove/admin mới thấy. Đặt lại checkbox mỗi lần đổi tab để không vô
  // tình mang theo lựa chọn ghim của loại bài trước đó.
  document.getElementById('internalPinField').classList.toggle('hidden', subTab === 'SHARE' || !canApproveInternalPost(currentUser));
  document.getElementById('internalPinCheckbox').checked = false;
  document.getElementById('internalPinDurationWrap').classList.add('hidden');

  // Checkbox "Gửi email thông báo lại cho người duyệt" (chỉ dùng khi resubmit NEED_INFO->PENDING) — reset
  // ẩn + bỏ tích mỗi lần đổi tab/mở lại form (kể cả từ editInternalPostUI()), tránh mang theo lựa chọn của
  // phiên Sửa bài trước đó. editInternalPostUI() tự hiện lại field này NGAY SAU khi gọi setInternalSubTab()
  // nếu đúng bài đang NEED_INFO — xem hàm đó bên dưới.
  document.getElementById('internalResendEmailField').classList.add('hidden');
  document.getElementById('internalResendEmailCheckbox').checked = false;

  // Chuyên đề (NEWS/SHARE, xem CORE_FIELD_MANIFEST.INTERNAL_POST_NEWS/INTERNAL_POST_SHARE) + Lịch đăng (chỉ NEWS) — chỉ 2 tab
  // này còn dùng #internalPostForm (Đào tạo/Tuyển dụng đã return sớm ở trên với form riêng).
  document.getElementById('internalCategoryNewsField').classList.toggle('hidden', subTab !== 'NEWS');
  document.getElementById('internalCategoryShareField').classList.toggle('hidden', subTab !== 'SHARE');
  document.getElementById('internalPublishAtField').classList.toggle('hidden', subTab !== 'NEWS');
  // BUG THẬT NGHIÊM TRỌNG đã vá (10/2026, nguyên nhân CHÍNH của "Nhịp Sống HCRC ko đăng được bài, các nút
  // thao tác ko sử dụng được"): #internalPostCategory/#internalPostCategoryShare đều khai required trong
  // HTML, nhưng chỉ 1 trong 2 hiện tại 1 thời điểm (còn lại bị ẩn qua class "hidden" ở trên) — thuộc tính
  // required KHÔNG tự mất hiệu lực chỉ vì phần tử bị ẩn bằng CSS (chỉ input[type=hidden]/disabled/readonly
  // mới được trình duyệt loại khỏi constraint validation, xem HTML5 spec — CSS "display:none" không đủ).
  // Kết quả: submit form (native HTML5 validation) bị trình duyệt ÂM THẦM CHẶN LẠI mỗi khi field ẩn còn
  // rỗng — đúng như vậy ngay ở lần đăng bài ĐẦU TIÊN trong phiên (chưa từng nhập ô kia bao giờ), khớp
  // "bấm nút Đăng Ngay/Lưu Nháp không có phản ứng gì" người dùng báo. Cùng khuôn offQty/offAmount đã tự
  // đổi required theo isMuaSam ở setOfficeSubTab() — áp dụng y hệt ở đây, đổi theo đúng subTab đang mở.
  document.getElementById('internalPostCategory').required = subTab === 'NEWS';
  document.getElementById('internalPostCategoryShare').required = subTab === 'SHARE';
  populateInternalPostCategorySelects();
  // Lọc theo chuyên đề (9/2026) + khởi tạo khung soạn thảo định dạng (1 lần) + dọn bản nháp ảnh/video của
  // tab trước (đổi tab = huỷ dở dang, cùng tinh thần editingInternalPostId = null ở trên).
  populateInternalCategoryFilter(subTab);
  initInternalContentEditor();
  setInternalEditorContent(null);
  resetInternalMediaDraft(null);
  // Góc Chia Sẻ (SHARE, 10/2026 theo yêu cầu người dùng): CHỈ cho nhúng link YouTube, KHÔNG cho tải file
  // video lên server (khác Nhịp Sống HCRC/NEWS vẫn cho cả 2 cách) — ẩn hẳn nút chuyển "⬆️ Tải video lên"
  // (chế độ mặc định 'youtube' cho tab SHARE đã tự chọn đúng ngay trong resetInternalMediaDraft() ở trên,
  // dựa vào activeInternalSubTab vừa gán ở đầu hàm này — xem chú thích ở đó). Server cũng chặn lại
  // (normalizeInternalPostMedia(), lib/createValidation.js) phòng khi 1 request tự soạn né qua UI này.
  document.getElementById('internalVideoModeTabs').classList.toggle('hidden', subTab === 'SHARE');
  // Biểu Mẫu tách 2 (10/2026, xem CORE_FIELD_MANIFEST.INTERNAL_POST_NEWS/INTERNAL_POST_SHARE ở core.js) —
  // "Trường Bổ Sung" của Nhịp Sống HCRC/Góc Chia Sẻ giờ đọc/ghi RIÊNG theo đúng modKey của tab đang mở,
  // không còn dùng chung 1 modKey 'INTERNAL_POST' như trước (container DOM vẫn dùng chung 1 id, chỉ modKey
  // để tra đúng danh sách "Trường Bổ Sung" đổi theo tab).
  renderDynamicInputsForModule(subTab === 'SHARE' ? 'INTERNAL_POST_SHARE' : 'INTERNAL_POST_NEWS', 'dynamicFieldsContainer_INTERNAL_POST');

  const icons = { NEWS: '📰', TRAINING: '🎓', SHARE: '💬' };
  document.getElementById('internalFormTitle').innerText = `📝 Đăng ${INTERNAL_TYPE_LABELS[subTab]} Mới`;
  document.getElementById('internalListTitle').innerText = `${icons[subTab]} Danh Sách ${INTERNAL_TYPE_LABELS[subTab]}`;
  // "Đăng ngay" / "Gửi duyệt" (Đợt 1) — thay nhãn nút submit chính cố định "Đăng <Loại>" cũ: Góc Chia Sẻ
  // của người KHÔNG có quyền duyệt còn phải qua hàng chờ (PENDING) nên gọi rõ "Gửi Duyệt", các trường
  // hợp còn lại (kể cả SHARE của chính người có quyền duyệt) công khai ngay nên gọi "Đăng Ngay".
  document.getElementById('internalSubmitBtn').innerText = (subTab === 'SHARE' && !canApproveInternalPost(currentUser)) ? 'Gửi Duyệt' : 'Đăng Ngay';

  const canCreate = canCreateInternalPost(currentUser, subTab);
  document.getElementById('internalPostForm').classList.toggle('hidden', !canCreate);
  document.getElementById('internalNoPermNote').classList.toggle('hidden', canCreate);

  renderInternalPosts();
}

function onInternalFilterChange() {
  resetListPage('internal');
  resetListPage('internalNews');
  renderInternalPosts();
}

function filterInternalByCard(status) {
  applyDashboardCardFilter({ filterStatusInternal: status }, 'internal', renderInternalPosts);
}

// editingInternalPostId khác null khi form đang Sửa 1 bài Nháp/Yêu cầu bổ sung có sẵn (thay vì tạo mới)
// — xem editInternalPostUI()/cancelEditInternalPost() bên dưới, cùng khuôn editingCoreField/
// editingCustomFieldId ở Biểu Mẫu.
let editingInternalPostId = null;

// ===== Nhịp Sống HCRC/Góc Chia Sẻ — nội dung định dạng + nhiều ảnh/ảnh đại diện/video (9/2026) =====
// 3 field MỚI images[]/coverImage/videos[] TÁCH BIỆT hẳn khỏi `attachment` cũ (KHÔNG tái dùng/ghi đè — xem
// chú thích BUG ở submitInternalPost() bên dưới về hậu quả của việc 1 field dùng lẫn lộn 2 mục đích).
// Giới hạn khớp server (lib/createValidation.js INTERNAL_POST_MAX_IMAGES/_MAX_VIDEOS, routes/upload.js
// INTERNAL_VIDEO_MAX_MB) — ở đây CHỈ để báo lỗi sớm, server mới là nơi chặn thật.
const INTERNAL_POST_MAX_IMAGES_CLIENT = 8;
const INTERNAL_POST_MAX_VIDEOS_CLIENT = 2;
const INTERNAL_VIDEO_MAX_MB_CLIENT = 200;
const INTERNAL_POST_CONTENT_MAX_LEN_CLIENT = 20000;
// Allowlist hiển thị — khớp ĐÚNG allowlist sanitize-html ở server (INTERNAL_POST_ALLOWED_TAGS).
const INTERNAL_RICH_ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'ul', 'ol', 'li', 'br', 'p'];
// Class hiển thị danh sách/đoạn cho nội dung HTML (Tailwind preflight bỏ bullet mặc định của <ul>/<ol>).
const INTERNAL_RICH_BODY_CLASSES = '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-1';

// Bản nháp media của form đang soạn (tạo mới hoặc Sửa) — mỗi tệp đã tải lên /api/upload NGAY khi chọn.
let internalMediaDraft = { images: [], coverUrl: null, videos: [] };
let internalMediaUploading = 0;

function isInternalPostHtml(p) {
  return !!p && p.contentFormat === 'html';
}

// Chữ thuần của nội dung bài (snippet feed, tìm kiếm từ khoá) — bài HTML parse qua DOMParser (tài liệu
// "trơ": không chạy script, không tải ảnh), bài cũ trả nguyên văn bản.
function internalPostPlainText(p) {
  if (!p) return '';
  if (!isInternalPostHtml(p)) return p.content || '';
  const withBreaks = String(p.content || '').replace(/<(br|\/p|\/li)\b[^>]*>/gi, '$& ');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

async function sanitizeInternalRichHtml(html) {
  await loadVendorScript('/vendor/dompurify/purify.min.js');
  return DOMPurify.sanitize(String(html || ''), { ALLOWED_TAGS: INTERNAL_RICH_ALLOWED_TAGS, ALLOWED_ATTR: [] });
}

// Thân bài ở modal Chi tiết: bài MỚI (contentFormat 'html') dựng khung rỗng rồi hydrateInternalRichBody()
// gán innerHTML SAU KHI lọc DOMPurify (lớp phòng thủ thứ 2, server đã sanitize allowlist); bài CŨ giữ
// NGUYÊN cách hiển thị cũ (escapeHtml + whitespace-pre-wrap) — không đổi dữ liệu lịch sử.
function internalPostBodyHTML(p) {
  if (isInternalPostHtml(p)) {
    return `<div class="internal-rich-body text-gray-800 ${INTERNAL_RICH_BODY_CLASSES}"></div>`;
  }
  return `<div class="whitespace-pre-wrap text-gray-800">${escapeHtml(p.content)}</div>`;
}

async function hydrateInternalRichBody(root, p) {
  const el = root?.querySelector('.internal-rich-body');
  if (!el || !isInternalPostHtml(p)) return;
  try {
    el.innerHTML = await sanitizeInternalRichHtml(p.content);
  } catch (err) {
    el.textContent = internalPostPlainText(p); // không tải được DOMPurify -> hiện chữ thuần, KHÔNG gán HTML thô
  }
}

// Chuyên đề (postCategory) — trước đây đã bắt buộc chọn nhưng CHƯA từng hiển thị cho người xem.
function internalPostCategoryLabel(p) {
  if (!p || !p.postCategory) return '';
  const list = p.type === 'SHARE' ? DB.internalShareCategories : DB.internalNewsCategories;
  const c = (list || []).find(x => x.key === p.postCategory);
  return c ? c.label : p.postCategory;
}
function internalPostCategoryBadgeHTML(p) {
  const label = internalPostCategoryLabel(p);
  return label
    ? `<span class="internal-cat-badge inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-700 align-middle">🏷️ ${escapeHtml(label)}</span>`
    : '';
}

// Dropdown lọc theo chuyên đề — danh sách đổi theo tab (NEWS/SHARE), giữ lựa chọn hiện tại nếu vẫn hợp lệ.
function populateInternalCategoryFilter(type) {
  const wrap = document.getElementById('internalCategoryFilterWrap');
  const sel = document.getElementById('filterCategoryInternal');
  const isFeed = type === 'NEWS' || type === 'SHARE';
  if (wrap) wrap.classList.toggle('hidden', !isFeed);
  if (!sel) return;
  const list = type === 'SHARE' ? (DB.internalShareCategories || []) : type === 'NEWS' ? (DB.internalNewsCategories || []) : [];
  const current = sel.value;
  sel.innerHTML = '<option value="">-- Tất cả chuyên đề --</option>' +
    list.map(c => `<option value="${escapeHtml(c.key)}">${escapeHtml(c.label)}</option>`).join('');
  sel.value = list.some(c => c.key === current) ? current : '';
}

// ---- Khung soạn thảo contenteditable (Bold + Danh sách) ----
let internalEditorSavedRange = null;
function initInternalContentEditor() {
  const ed = document.getElementById('internalContent');
  if (!ed || ed.dataset.editorReady === '1') return;
  ed.dataset.editorReady = '1';
  // Enter sinh <p> thay vì <div> (server vẫn tự đổi div->p nếu trình duyệt không hỗ trợ lệnh này).
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) { /* không hỗ trợ -> bỏ qua */ }
  // Dán luôn chèn CHỮ THUẦN — không mang theo định dạng/thẻ lạ từ Word/web (server cũng sẽ lọc bỏ).
  ed.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
    document.execCommand('insertText', false, text);
  });
  // Nhớ vùng chọn cuối cùng bên trong khung soạn — bấm nút toolbar làm mất focus khỏi khung, khôi phục lại
  // vùng chọn trước khi chạy lệnh để Bold/Danh sách áp đúng đoạn người dùng vừa bôi đen.
  document.addEventListener('selectionchange', () => {
    const sel = document.getSelection();
    if (sel && sel.rangeCount && ed.contains(sel.anchorNode)) internalEditorSavedRange = sel.getRangeAt(0).cloneRange();
  });
}

function internalEditorExec(cmd) {
  if (cmd !== 'bold' && cmd !== 'insertUnorderedList') return; // chỉ 2 lệnh của bộ nút tối giản
  const ed = document.getElementById('internalContent');
  if (!ed) return;
  ed.focus();
  if (internalEditorSavedRange && ed.contains(internalEditorSavedRange.startContainer)) {
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(internalEditorSavedRange);
  }
  document.execCommand(cmd, false, null);
}

function getInternalEditorHtml() {
  const ed = document.getElementById('internalContent');
  if (!ed) return '';
  const text = (ed.textContent || '').replace(/ /g, ' ').trim();
  return text ? ed.innerHTML.trim() : '';
}

async function setInternalEditorContent(p) {
  const ed = document.getElementById('internalContent');
  if (!ed) return;
  if (!p) { ed.innerHTML = ''; return; }
  if (isInternalPostHtml(p)) {
    try { ed.innerHTML = await sanitizeInternalRichHtml(p.content); } catch (_) { ed.textContent = internalPostPlainText(p); }
  } else {
    ed.innerText = p.content || ''; // bài cũ (văn bản thuần) -> innerText tự đổi xuống dòng thành <br>
  }
}

// ---- Video nhúng YouTube (9/2026) ----
// videos[] có 2 dạng phần tử: {type:'upload', fileUrl, fileName} (tệp tải lên, như cũ) và
// {type:'youtube', youtubeUrl} (dán link YouTube — không tốn dung lượng server). TƯƠNG THÍCH NGƯỢC: phần tử
// KHÔNG có type (bài cũ) LUÔN coi là 'upload' — chỉ type === 'youtube' tường minh mới đi nhánh YouTube (khớp
// normalizeInternalPostFileList() ở lib/createValidation.js, server là nơi xác thực cuối).
// Tách videoId: bản gọn RIÊNG của module này (cùng luật với extractYoutubeVideoId() của Đào Tạo LMS, không
// dùng chung để không đụng tới LMS), nhưng CHẶT hơn: bắt buộc https: + đúng 4 tên miền YouTube (khớp
// isValidYoutubeUrl() ở server) và videoId chỉ gồm [A-Za-z0-9_-] — id đi thẳng vào src iframe nhúng.
const INTERNAL_YOUTUBE_HOSTNAMES_CLIENT = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
function isInternalYoutubeVideo(v) {
  return !!v && v.type === 'youtube';
}
function internalYoutubeVideoId(url) {
  if (!url) return null;
  let u;
  try { u = new URL(String(url).trim()); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  if (!INTERNAL_YOUTUBE_HOSTNAMES_CLIENT.includes(host)) return null;
  let id = null;
  if (host === 'youtu.be') {
    id = u.pathname.split('/')[1] || null;
  } else {
    id = u.searchParams.get('v');
    if (!id) {
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/);
      if (m) id = m[1];
    }
  }
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
}
function internalYoutubeEmbedUrl(url) {
  const id = internalYoutubeVideoId(url);
  return id ? `https://www.youtube.com/embed/${id}` : null;
}

// ---- Ảnh/Video (bản nháp media của form) ----
function resetInternalMediaDraft(p) {
  const pick = (arr) => (Array.isArray(arr) ? arr : []).filter(x => x && x.fileUrl).map(x => ({ fileUrl: x.fileUrl, fileName: x.fileName || '' }));
  // videos[]: giữ đúng loại từng phần tử — bài cũ (không có type) hiện như video tải lên cũ.
  const pickVideos = (arr) => (Array.isArray(arr) ? arr : []).map(x => {
    if (!x) return null;
    if (isInternalYoutubeVideo(x)) return x.youtubeUrl ? { type: 'youtube', youtubeUrl: String(x.youtubeUrl) } : null;
    return x.fileUrl ? { type: 'upload', fileUrl: x.fileUrl, fileName: x.fileName || '' } : null;
  }).filter(Boolean);
  internalMediaDraft = {
    images: pick(p?.images),
    coverUrl: p?.coverImage?.fileUrl || null,
    videos: pickVideos(p?.videos)
  };
  ['internalImagesInput', 'internalVideosInput', 'internalYoutubeUrlInput'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['internalImagesStatus', 'internalVideosStatus'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = ''; });
  // Góc Chia Sẻ (SHARE, 10/2026): không có nút chuyển sang "Tải video lên" (ẩn ở setInternalSubTab()) nên
  // PHẢI mở sẵn đúng ô "Dán link YouTube" ngay từ đầu, không thì người dùng sẽ thấy trống trơn (ô upload
  // ẩn nhưng vẫn là mode mặc định 'upload' nếu không đổi ở đây). Dùng activeInternalSubTab (đã gán ở đầu
  // setInternalSubTab(), CHẠY TRƯỚC lệnh gọi hàm này dù gọi từ setInternalSubTab() hay từ
  // editInternalPostUI() gọi lại lần 2 với dữ liệu bài thật — cả 2 đường đều đã có đúng giá trị).
  setInternalVideoMode(activeInternalSubTab === 'SHARE' ? 'youtube' : 'upload');
  renderInternalMediaDraft();
}

// Chuyển chế độ thêm video: 'upload' (chọn tệp) / 'youtube' (dán link) — chỉ đổi ô nhập đang hiện, KHÔNG
// đụng tới các video đã thêm vào bản nháp (2 loại dùng chung trần INTERNAL_POST_MAX_VIDEOS_CLIENT).
function setInternalVideoMode(mode) {
  const m = mode === 'youtube' ? 'youtube' : 'upload';
  // Enter trong ô link = bấm "➕ Thêm" — chặn submit ngầm của form (vốn còn bị kiểm tra `required` của trình
  // duyệt chặn trước khi tới submitInternalPost()). addEventListener qua JS (không phải thuộc tính on*=
  // nội tuyến) nên hợp lệ CSP; gắn đúng 1 lần/phần tử (form nằm trong fragment tải lười).
  const ytInput = document.getElementById('internalYoutubeUrlInput');
  if (ytInput && !ytInput.dataset.ytEnterBound) {
    ytInput.dataset.ytEnterBound = '1';
    ytInput.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || ev.isComposing) return;
      ev.preventDefault();
      addInternalYoutubeVideo();
    });
  }
  document.getElementById('internalVideoUploadBox')?.classList.toggle('hidden', m !== 'upload');
  document.getElementById('internalVideoYoutubeBox')?.classList.toggle('hidden', m !== 'youtube');
  document.querySelectorAll('#internalVideoModeTabs .internal-video-mode-btn').forEach(btn => {
    const on = btn.dataset.videoMode === m;
    btn.classList.toggle('bg-fuchsia-600', on);
    btn.classList.toggle('text-white', on);
    btn.classList.toggle('bg-white', !on);
    btn.classList.toggle('text-gray-700', !on);
  });
}

// Nút "➕ Thêm" (data-op) — kiểm tra nhẹ phía client (link YouTube tách được videoId, chưa vượt trần 2 video
// gộp, chưa trùng) rồi đưa vào bản nháp; server kiểm tra lại bằng isValidYoutubeUrl() lúc lưu.
function addInternalYoutubeVideo() {
  const input = document.getElementById('internalYoutubeUrlInput');
  const status = document.getElementById('internalVideosStatus');
  const url = String(input?.value || '').trim();
  if (!url) return alert('⚠️ Vui lòng dán link YouTube trước khi bấm Thêm.');
  if (internalMediaDraft.videos.length >= INTERNAL_POST_MAX_VIDEOS_CLIENT) {
    return alert(`⛔ Mỗi bài chỉ được tối đa ${INTERNAL_POST_MAX_VIDEOS_CLIENT} video (tính chung cả video tải lên và link YouTube).`);
  }
  if (!internalYoutubeVideoId(url)) {
    return alert('⛔ Link YouTube không hợp lệ — dùng link https://www.youtube.com/watch?v=... hoặc https://youtu.be/... của 1 video cụ thể.');
  }
  if (internalMediaDraft.videos.some(v => isInternalYoutubeVideo(v) && v.youtubeUrl === url)) {
    return alert('⚠️ Link YouTube này đã có trong bài.');
  }
  internalMediaDraft.videos.push({ type: 'youtube', youtubeUrl: url });
  if (input) input.value = '';
  if (status) status.textContent = '';
  renderInternalMediaDraft();
}

function renderInternalMediaDraft() {
  const imgBox = document.getElementById('internalImagesPreview');
  const vidBox = document.getElementById('internalVideosPreview');
  const coverUrl = internalMediaDraft.coverUrl || internalMediaDraft.images[0]?.fileUrl || null;
  if (imgBox) {
    imgBox.innerHTML = internalMediaDraft.images.map((img, idx) => {
      const isCover = img.fileUrl === coverUrl;
      return `
        <div class="internal-draft-image relative w-20 h-20 rounded border-2 ${isCover ? 'border-fuchsia-600' : 'border-gray-200'} bg-gray-50 overflow-hidden">
          <img src="${escapeHtml(img.fileUrl)}" alt="${escapeHtml(img.fileName)}" title="Bấm để chọn làm ảnh đại diện" data-op="setInternalDraftCover" data-arg0="${idx}" class="w-full h-full object-cover cursor-pointer">
          ${isCover ? '<span class="internal-draft-cover-badge absolute bottom-0 left-0 right-0 bg-fuchsia-600 text-white text-[9px] font-bold text-center">⭐ Đại diện</span>' : ''}
          <button type="button" data-op="removeInternalDraftImage" data-arg0="${idx}" title="Bỏ ảnh này" class="absolute top-0 right-0 bg-white text-red-600 text-xs font-bold px-1 leading-none rounded-bl">×</button>
        </div>`;
    }).join('');
  }
  if (vidBox) {
    vidBox.innerHTML = internalMediaDraft.videos.map((v, idx) => `
      <div class="internal-draft-video flex items-center justify-between gap-2 bg-gray-50 border rounded px-2 py-1" data-video-type="${isInternalYoutubeVideo(v) ? 'youtube' : 'upload'}">
        <span class="truncate">${isInternalYoutubeVideo(v) ? `▶️ YouTube: ${escapeHtml(v.youtubeUrl)}` : `🎬 ${escapeHtml(v.fileName || v.fileUrl)}`}</span>
        <button type="button" data-op="removeInternalDraftVideo" data-arg0="${idx}" class="text-red-600 font-bold">× Bỏ</button>
      </div>`).join('');
  }
}

async function onInternalImagesChosen(input) {
  const files = Array.from(input?.files || []);
  if (input) input.value = '';
  if (!files.length) return;
  const status = document.getElementById('internalImagesStatus');
  const room = INTERNAL_POST_MAX_IMAGES_CLIENT - internalMediaDraft.images.length;
  if (room <= 0) return alert(`⛔ Mỗi bài chỉ được tối đa ${INTERNAL_POST_MAX_IMAGES_CLIENT} ảnh.`);
  if (files.length > room) alert(`⚠️ Chỉ thêm được ${room} ảnh nữa (tối đa ${INTERNAL_POST_MAX_IMAGES_CLIENT} ảnh/bài) — các ảnh còn lại bị bỏ qua.`);
  const errors = [];
  for (const file of files.slice(0, room)) {
    internalMediaUploading++;
    if (status) status.textContent = `⏳ Đang tải ảnh "${file.name}"...`;
    try {
      const up = await uploadFileToServer(file, 'internalImage');
      if (internalMediaDraft.images.length < INTERNAL_POST_MAX_IMAGES_CLIENT) {
        internalMediaDraft.images.push({ fileUrl: up.fileUrl, fileName: up.fileName || file.name });
      }
    } catch (err) {
      errors.push(`${file.name}: ${err.message}`);
    } finally {
      internalMediaUploading--;
    }
  }
  if (status) status.textContent = errors.length ? `⛔ ${errors.join(' | ')}` : '';
  renderInternalMediaDraft();
}

async function onInternalVideosChosen(input) {
  const files = Array.from(input?.files || []);
  if (input) input.value = '';
  if (!files.length) return;
  const status = document.getElementById('internalVideosStatus');
  const room = INTERNAL_POST_MAX_VIDEOS_CLIENT - internalMediaDraft.videos.length;
  if (room <= 0) return alert(`⛔ Mỗi bài chỉ được tối đa ${INTERNAL_POST_MAX_VIDEOS_CLIENT} video (tính chung cả video tải lên và link YouTube).`);
  if (files.length > room) alert(`⚠️ Chỉ thêm được ${room} video nữa (tối đa ${INTERNAL_POST_MAX_VIDEOS_CLIENT} video/bài, tính chung cả link YouTube) — các video còn lại bị bỏ qua.`);
  const errors = [];
  for (const file of files.slice(0, room)) {
    if (!/\.(mp4|webm)$/i.test(file.name)) { errors.push(`${file.name}: chỉ nhận .mp4/.webm`); continue; }
    if (file.size > INTERNAL_VIDEO_MAX_MB_CLIENT * 1024 * 1024) { errors.push(`${file.name}: vượt quá ${INTERNAL_VIDEO_MAX_MB_CLIENT}MB`); continue; }
    internalMediaUploading++;
    if (status) status.textContent = `⏳ Đang tải video "${file.name}" (tệp lớn có thể mất vài phút)...`;
    try {
      const up = await uploadFileToServer(file, 'internalVideo');
      if (internalMediaDraft.videos.length < INTERNAL_POST_MAX_VIDEOS_CLIENT) {
        internalMediaDraft.videos.push({ type: 'upload', fileUrl: up.fileUrl, fileName: up.fileName || file.name });
      }
    } catch (err) {
      errors.push(`${file.name}: ${err.message}`);
    } finally {
      internalMediaUploading--;
    }
  }
  if (status) status.textContent = errors.length ? `⛔ ${errors.join(' | ')}` : '';
  renderInternalMediaDraft();
}

function setInternalDraftCover(idx) {
  const img = internalMediaDraft.images[Number(idx)];
  if (!img) return;
  internalMediaDraft.coverUrl = img.fileUrl;
  renderInternalMediaDraft();
}

function removeInternalDraftImage(idx) {
  const i = Number(idx);
  const removed = internalMediaDraft.images[i];
  if (!removed) return;
  internalMediaDraft.images.splice(i, 1);
  if (internalMediaDraft.coverUrl === removed.fileUrl) internalMediaDraft.coverUrl = null; // lùi về ảnh đầu
  renderInternalMediaDraft();
}

function removeInternalDraftVideo(idx) {
  const i = Number(idx);
  if (!internalMediaDraft.videos[i]) return;
  internalMediaDraft.videos.splice(i, 1);
  renderInternalMediaDraft();
}

// Payload images/coverImage/videos gửi server — coverImage mặc định ảnh đầu tiên nếu tác giả chưa chọn.
function buildInternalMediaPayload() {
  const images = internalMediaDraft.images.map(x => ({ fileUrl: x.fileUrl, fileName: x.fileName }));
  const cover = images.find(x => x.fileUrl === internalMediaDraft.coverUrl) || images[0] || null;
  // videos[]: đúng 2 dạng đã chốt — {type:'youtube', youtubeUrl} hoặc {type:'upload', fileUrl, fileName}.
  const videos = internalMediaDraft.videos.map(x => (isInternalYoutubeVideo(x)
    ? { type: 'youtube', youtubeUrl: x.youtubeUrl }
    : { type: 'upload', fileUrl: x.fileUrl, fileName: x.fileName }));
  return { images, coverImage: cover, videos };
}

async function submitInternalPost(e) {
  e.preventDefault();
  // Nhấn Enter trong ô link YouTube = "Thêm" link đó (submit ngầm của form HTML), KHÔNG đăng bài.
  if (document.activeElement && document.activeElement.id === 'internalYoutubeUrlInput') {
    addInternalYoutubeVideo();
    return;
  }
  // Đã dán link YouTube nhưng quên bấm "➕ Thêm" — nhắc thay vì âm thầm đăng bài thiếu video.
  const pendingYoutube = String(document.getElementById('internalYoutubeUrlInput')?.value || '').trim();
  if (pendingYoutube && !document.getElementById('internalVideoYoutubeBox')?.classList.contains('hidden')) {
    return alert('⚠️ Bạn đã dán link YouTube nhưng chưa bấm "➕ Thêm" — bấm Thêm (hoặc xoá link) rồi đăng bài lại.');
  }
  const type = activeInternalSubTab;
  const isEditing = !!editingInternalPostId;
  // 2 nút submit CÙNG form ("Lưu Nháp"/"Đăng Ngay-Gửi Duyệt") — phân biệt bằng nút NÀO thực sự kích
  // hoạt submit (event.submitter, chuẩn HTML form), không phải trạng thái ngoài form nào khác.
  const isDraftSubmit = e.submitter?.id === 'internalDraftBtn';

  if (!isEditing && !canCreateInternalPost(currentUser, type)) {
    return alert('⛔ Bạn không có quyền đăng bài ở phân hệ này!');
  }

  const title = document.getElementById('internalTitle').value.trim();
  // Nội dung định dạng (9/2026) — HTML từ khung contenteditable #internalContent (không còn là textarea),
  // gửi kèm contentFormat:'html'; server sanitize allowlist lại (normalizeInternalPostContent()).
  const content = getInternalEditorHtml();
  if (!content) return alert('⛔ Vui lòng nhập nội dung bài viết!');
  if (content.length > INTERNAL_POST_CONTENT_MAX_LEN_CLIENT) return alert(`⛔ Nội dung quá dài (tối đa ${INTERNAL_POST_CONTENT_MAX_LEN_CLIENT} ký tự kể cả định dạng).`);
  if (internalMediaUploading > 0) return alert('⏳ Đang tải ảnh/video lên, vui lòng đợi tải xong rồi đăng bài.');
  const media = buildInternalMediaPayload();

  let training = null;
  if (type === 'TRAINING') {
    const startTime = document.getElementById('internalTrainingStart').value;
    if (!startTime) return alert('Vui lòng nhập Thời Gian Bắt Đầu cho khóa đào tạo!');
    training = {
      startTime,
      endTime: document.getElementById('internalTrainingEnd').value,
      location: document.getElementById('internalTrainingLocation').value.trim(),
      registerDeadline: document.getElementById('internalTrainingDeadline').value,
      capacity: parseInt(document.getElementById('internalTrainingCapacity').value, 10) || 0,
      registeredUsers: []
    };
  }

  // Chuyên đề (NEWS/SHARE, xem CORE_FIELD_MANIFEST.INTERNAL_POST_NEWS/INTERNAL_POST_SHARE) — 2 <select> riêng theo type, server
  // tự kiểm tra lại key có hợp lệ không (extraValidate), client chỉ đọc đúng ô đang hiện.
  let postCategory;
  if (type === 'NEWS') postCategory = document.getElementById('internalPostCategory')?.value || '';
  else if (type === 'SHARE') postCategory = document.getElementById('internalPostCategoryShare')?.value || '';

  // Lịch đăng (chỉ NEWS) — để trống = đăng ngay. Gửi thẳng giá trị input datetime-local (giờ địa
  // phương người dùng), server tự new Date() parse lại rồi lưu ISO (extraValidate/editInternalPost()).
  let publishAt;
  if (type === 'NEWS') publishAt = document.getElementById('internalPublishAt')?.value || '';

  const fileInput = document.getElementById('internalFile');
  let attachment;
  if (fileInput?.files[0]) {
    // BUG THẬT đã vá (10/2026, người dùng báo "ảnh chọn được nhưng ko đăng bài được"): #internalFile
    // dùng CHUNG cho cả tệp văn bản LẪN ảnh bìa bài viết (xem isInternalImageAttachment(), coverHTML ở
    // renderInternalNewsCard()/renderInternalPostCard() phía dưới) nhưng luôn gửi cứng moduleKey
    // 'internal' — moduleKey này ở "Quản Lý Tệp File" (routes/upload.js) mặc định CHỈ cho .pdf/.docx/.xlsx
    // (đúng như accept= của input), không có ảnh; nếu admin đã cấu hình đúng như nhãn "Truyền Thông Nội
    // Bộ" gợi ý thì mọi ảnh bìa bị server từ chối. Cùng lỗi đã vá cho banner tuyển dụng (rjBannerFile,
    // luôn dùng 'internalImage' — xem submitRecruitmentJob()) nhưng bỏ sót ở đây vì field này dùng
    // CHUNG cho cả 2 loại tệp. Tự nhận diện qua file.type (MIME type chuẩn của File API, không phải đoán
    // theo đuôi file) để chọn đúng moduleKey — ảnh dùng 'internalImage', còn lại vẫn 'internal' như cũ.
    const chosenFile = fileInput.files[0];
    const uploadModuleKey = chosenFile.type.startsWith('image/') ? 'internalImage' : 'internal';
    try {
      const uploaded = await uploadFileToServer(chosenFile, uploadModuleKey);
      attachment = { fileName: uploaded.fileName, fileType: uploaded.fileType, fileUrl: uploaded.fileUrl };
    } catch (err) {
      return alert(`⛔ Tải tệp đính kèm thất bại: ${err.message}`);
    }
  } else if (!isEditing) {
    attachment = null; // Tạo mới, không chọn tệp = rõ ràng "không có đính kèm"
  }
  // Sửa bài mà không chọn tệp mới: KHÔNG gán attachment (giữ undefined) để bỏ hẳn field này khỏi
  // payload gửi đi — editInternalPost() (lib/recordActions.js) chỉ ghi đè field CÓ MẶT trong payload,
  // undefined nghĩa là "giữ nguyên đính kèm cũ", không tự ý xoá đính kèm bài đã có.

  // Trường bổ sung (Biểu Mẫu > Truyền Thông Nội Bộ - Nhịp Sống HCRC/Góc Chia Sẻ, tách riêng 10/2026) —
  // chỉ NEWS/SHARE còn hiện #dynamicFieldsContainer_INTERNAL_POST (TRAINING/RECRUITMENT return sớm ở
  // trên với form riêng). modKey PHẢI khớp đúng modKey đã dùng để render ở setInternalSubTab() ngay trên.
  let customData;
  try {
    customData = await collectDynamicFieldsData(type === 'SHARE' ? 'INTERNAL_POST_SHARE' : 'INTERNAL_POST_NEWS', 'dynamicFieldsContainer_INTERNAL_POST');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  // Sửa bài: gộp với customData cũ của bài (thay vì ghi đè toàn bộ) — cùng lý do với attachment ở
  // trên, tránh mất giá trị trường kiểu Tải tệp không được chọn lại (collectDynamicFieldsData() bỏ
  // hẳn field đó khỏi kết quả khi không có tệp mới, xem hàm này ở phần Biểu Mẫu).
  let originalPostStatus;
  if (isEditing) {
    const existingPost = DB.internalPosts.find(x => x.id === editingInternalPostId);
    originalPostStatus = existingPost?.status;
    customData = { ...(existingPost?.customData || {}), ...customData };
  }

  if (isEditing) {
    const payload = { title, content, contentFormat: 'html', draft: isDraftSubmit, customData, ...media };
    if (attachment !== undefined) payload.attachment = attachment;
    if (type === 'TRAINING') payload.training = training;
    if (type === 'NEWS' || type === 'SHARE') payload.postCategory = postCategory;
    if (type === 'NEWS') payload.publishAt = publishAt;

    let updated;
    try {
      const result = await callRecordAction('internalPosts', editingInternalPostId, 'edit', payload);
      updated = result.item;
    } catch (err) {
      return alert(`⛔ ${err.message}`);
    }
    const idx = DB.internalPosts.findIndex(x => x.id === updated.id);
    if (idx !== -1) DB.internalPosts[idx] = updated; else DB.internalPosts.unshift(updated);
    logSystemAction('INTERNAL', 'EDIT_INTERNAL_POST', `Sửa ${INTERNAL_TYPE_LABELS[type]} [${updated.code} - ${title}]`, 'SUCCESS', updated.code);
    // Resubmit thật (NEED_INFO -> PENDING, xem requestInternalPostInfoAction()) — mặc định KHÔNG gửi lại
    // email cho người duyệt, chỉ gửi khi tác giả CHỦ ĐỘNG tích checkbox "Gửi email thông báo lại" (hiện
    // đúng ngữ cảnh này ở editInternalPostUI()). Dùng LẠI y hệt pattern notifyUsersByEmail() của nhánh tạo
    // mới bên dưới (!isEditing) — cùng người nhận (getInternalPostApproverUsernames()), cùng loại thông báo.
    if (originalPostStatus === 'NEED_INFO' && updated.status === 'PENDING' && document.getElementById('internalResendEmailCheckbox')?.checked) {
      const approvers = getInternalPostApproverUsernames();
      notifyUsersByEmail('INTERNAL', 'NOTIFY_APPROVAL_NEEDED', updated.code, approvers,
        `[VPDT] Bài đăng Góc Chia Sẻ chờ duyệt: ${title}`,
        `${currentUser.name} vừa gửi lại bài "${title}" sau khi bổ sung theo yêu cầu, đang chờ phê duyệt trước khi công khai.`);
    }
    cancelEditInternalPost();
    if (updated.status === 'DRAFT') alert('✅ Đã lưu nháp!');
    else if (updated.status === 'PENDING') alert('✅ Đã gửi lại, bài viết sẽ hiển thị công khai sau khi được phê duyệt!');
    else alert('✅ Đã cập nhật và đăng bài thành công!');
    renderInternalPosts();
    return;
  }

  const postPayload = {
    type,
    // code (BỎ, phát hiện #14, rà soát chuyên sâu vòng 2, 9/2026): SERVER tự sinh theo TYPE
    // (createValidation.js internalPosts.generateCode) — không còn tin code client tự tính nữa.
    title, content,
    contentFormat: 'html',
    attachment,
    images: media.images,
    coverImage: media.coverImage,
    videos: media.videos,
    training,
    customData,
    createdAt: new Date().toLocaleString('vi-VN'),
    comments: [],
    likes: [],
    readBy: [currentUser.username]
  };
  if (type === 'NEWS' || type === 'SHARE') postPayload.postCategory = postCategory;
  if (type === 'NEWS' && publishAt) postPayload.publishAt = publishAt;
  if (isDraftSubmit) postPayload.draft = true;
  // Ghim lên trang chủ (Đợt E) — chỉ gửi kèm số ngày muốn ghim khi có tick chọn; server tự tính
  // pinExpiresAt và kiểm tra lại quyền (không tin trực tiếp bất kỳ giá trị pin nào từ client).
  if (document.getElementById('internalPinCheckbox').checked) {
    postPayload.pinDurationDays = document.getElementById('internalPinDuration').value;
  }

  let newPost;
  try {
    const result = await callCreateAction('internalPosts', postPayload);
    newPost = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }

  DB.internalPosts.unshift(newPost);
  logSystemAction('INTERNAL', 'CREATE_INTERNAL_POST', `Đăng ${INTERNAL_TYPE_LABELS[type]} [${newPost.code} - ${title}]`, 'SUCCESS', newPost.code);

  if (newPost.status === 'DRAFT') {
    alert('✅ Đã lưu nháp — bài chưa công khai, vào bài của bạn trong danh sách để Sửa/Gửi sau!');
  } else if (newPost.status === 'PENDING') {
    const approvers = getInternalPostApproverUsernames();
    notifyUsersByEmail('INTERNAL', 'NOTIFY_APPROVAL_NEEDED', newPost.code, approvers,
      `[VPDT] Bài đăng Góc Chia Sẻ chờ duyệt: ${title}`,
      `${currentUser.name} vừa đăng bài "${title}" trong Góc Chia Sẻ, đang chờ phê duyệt trước khi công khai.`);
    alert('✅ Đã gửi bài, bài viết sẽ hiển thị công khai sau khi được phê duyệt!');
  } else {
    alert('✅ Đã đăng bài thành công!');
  }
  resetInternalPostForm();
  renderInternalPosts();
}

// Sửa bài Nháp/"Yêu cầu bổ sung" (NEED_INFO) — mở lại chính #internalPostForm, điền sẵn dữ liệu cũ rồi
// chuyển submitInternalPost() sang nhánh gọi POST .../edit thay vì tạo mới. Điều kiện hiện nút PHẢI khớp
// Y HỆT editInternalPost() (lib/recordActions.js) để không hiện nút rồi vẫn bị server từ chối.
function canEditInternalPostUI(p) {
  return !!p && (p.status === 'DRAFT' || p.status === 'NEED_INFO') && (p.author === currentUser.username || currentUser.perms?.admin);
}

async function editInternalPostUI(id) {
  const p = DB.internalPosts.find(x => x.id === id);
  if (!canEditInternalPostUI(p)) return;
  closeInternalArticleModal();
  // await switchTab() (Ha tang: nap module theo cum, dot 7) - tranh setInternalSubTab(p.type) ngay duoi
  // chay TRUOC phan render mac dinh cua switchTab('internal') (activeInternalSubTab CU) roi bi render lai
  // đè len 1 nhip sau do, gay nhay/render 2 lan (ca 2 ham cung dinh nghia trong module nay nen KHONG gay
  // ReferenceError, chi la thu tu chay khong dam bao neu khong await).
  await switchTab('internal');
  setInternalSubTab(p.type); // reset form trắng + đúng tab con trước, điền lại dữ liệu cũ ngay dưới đây
  editingInternalPostId = p.id;

  document.getElementById('internalTitle').value = p.title || '';
  await setInternalEditorContent(p);
  resetInternalMediaDraft(p);
  if (p.type === 'TRAINING' && p.training) {
    document.getElementById('internalTrainingStart').value = p.training.startTime || '';
    document.getElementById('internalTrainingEnd').value = p.training.endTime || '';
    document.getElementById('internalTrainingLocation').value = p.training.location || '';
    document.getElementById('internalTrainingDeadline').value = p.training.registerDeadline || '';
    document.getElementById('internalTrainingCapacity').value = p.training.capacity || '';
  }
  if (p.type === 'NEWS') {
    const sel = document.getElementById('internalPostCategory');
    if (sel) sel.value = p.postCategory || '';
    const publishAtInput = document.getElementById('internalPublishAt');
    if (publishAtInput) publishAtInput.value = p.publishAt ? toDatetimeLocalValue(new Date(p.publishAt)) : '';
  } else if (p.type === 'SHARE') {
    const sel = document.getElementById('internalPostCategoryShare');
    if (sel) sel.value = p.postCategory || '';
  }
  prefillDynamicFieldsData('dynamicFieldsContainer_INTERNAL_POST', p.customData);

  // Resubmit thật (NEED_INFO -> PENDING) — chỉ ở đây mới hiện checkbox "Gửi email thông báo lại cho
  // người duyệt" (đã bị ẩn + bỏ tích sẵn ở setInternalSubTab() ngay phía trên). Sửa bài Nháp (chưa từng
  // gửi duyệt) thì field này giữ nguyên trạng thái ẩn.
  if (p.status === 'NEED_INFO') {
    document.getElementById('internalResendEmailField').classList.remove('hidden');
  }

  document.getElementById('internalFormTitle').innerText = `✏️ Sửa ${INTERNAL_TYPE_LABELS[p.type]}`;
  document.getElementById('internalSubmitBtn').innerText = p.status === 'NEED_INFO' ? 'Gửi Lại' : 'Gửi';
  document.getElementById('internalCancelEditBtn').classList.remove('hidden');
  document.getElementById('internalPostForm').classList.remove('hidden');
  document.getElementById('internalNoPermNote').classList.add('hidden');
  document.getElementById('internalPostForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEditInternalPost() {
  editingInternalPostId = null;
  document.getElementById('internalPostForm').reset();
  // form.reset() không đụng tới div contenteditable/bản nháp ảnh-video (không phải form control) — tự dọn.
  setInternalEditorContent(null);
  resetInternalMediaDraft(null);
  document.getElementById('internalCancelEditBtn').classList.add('hidden');
  setInternalSubTab(activeInternalSubTab); // khôi phục tiêu đề/nhãn nút mặc định của tab hiện tại
}
// resetInternalPostForm() — nút "↺ Làm Mới" (data-op="confirmAndResetForm" data-arg1=
// "resetInternalPostForm", xem core.js) VÀ luồng đăng bài MỚI thành công ở trên (nhánh Sửa đã gọi thẳng
// cancelEditInternalPost() sẵn — xem submitInternalPost()). Hành vi cần GIỐNG HỆT "Huỷ Sửa" (thoát Sửa dở
// dang nếu có + trắng form + setInternalSubTab() tự đặt lại Ghim/Gửi lại email về mặc định của tab hiện
// tại, xem setInternalSubTab()) — gọi lại thẳng cancelEditInternalPost(), cùng khuôn
// resetMeetingMinutesForm()/module-bienbanhop.js — CHỈ thêm bước xoá chip file đính kèm (form.reset()
// không tự bắn 'change' nên chip cũ không tự xoá, xem core.js).
function resetInternalPostForm() {
  cancelEditInternalPost();
  clearSingleFileInput('internalFile', 'internalFileChip');
}

// Wrapper cho CSP: checkbox "Ghim bài" đọc this.checked (không có data-arg-checked trong
// bindCspDelegation) -> nhận thẳng element qua data-arg-el rồi tự đọc el.checked ở đây.
function toggleInternalPinDurationWrap(el) {
  document.getElementById('internalPinDurationWrap').classList.toggle('hidden', !el.checked);
}

// Ẩn/Hiện lại bài đã đăng (APPROVED<->HIDDEN, mọi type) — chỉ canApproveInternalPost, khớp
// hideInternalPost()/unhideInternalPost() ở lib/recordActions.js. Cùng khuôn approveInternalPostAction
// ở dưới (showConfirmModal + callRecordAction), không cần lý do như Từ chối/Yêu cầu bổ sung.
function hideInternalPostAction(id) {
  const p = DB.internalPosts.find(x => x.id === id);
  if (!p) return;
  showConfirmModal({
    title: 'Ẩn bài đăng',
    bodyHTML: `Bạn có chắc chắn muốn ẩn bài "<b>${escapeHtml(p.title)}</b>" khỏi trang chủ/chuyên mục?`,
    confirmLabel: 'Ẩn Bài',
    onConfirm: async () => {
      let updated;
      try {
        const result = await callRecordAction('internalPosts', id, 'hide', {});
        updated = result.item;
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const idx = DB.internalPosts.findIndex(x => x.id === id);
      if (idx !== -1) DB.internalPosts[idx] = updated;
      logSystemAction('INTERNAL', 'HIDE_INTERNAL_POST', `Ẩn bài [${updated.code} - ${updated.title}]`, 'SUCCESS', updated.code);
      closeInternalArticleModal();
      renderInternalPosts();
    }
  });
}

function unhideInternalPostAction(id) {
  const p = DB.internalPosts.find(x => x.id === id);
  if (!p) return;
  showConfirmModal({
    title: 'Hiện lại bài đăng',
    bodyHTML: `Bạn có chắc chắn muốn hiện lại bài "<b>${escapeHtml(p.title)}</b>"?`,
    confirmLabel: 'Hiện Lại',
    onConfirm: async () => {
      let updated;
      try {
        const result = await callRecordAction('internalPosts', id, 'unhide', {});
        updated = result.item;
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const idx = DB.internalPosts.findIndex(x => x.id === id);
      if (idx !== -1) DB.internalPosts[idx] = updated;
      logSystemAction('INTERNAL', 'UNHIDE_INTERNAL_POST', `Hiện lại bài [${updated.code} - ${updated.title}]`, 'SUCCESS', updated.code);
      closeInternalArticleModal();
      renderInternalPosts();
    }
  });
}

// Xoá bài đăng (BỔ SUNG — phát hiện #12, rà soát chuyên sâu vòng 2, 9/2026) — CHỈ Admin (khớp
// deleteAdminOnly() ở routes/records.js), dọn bài Nháp/Đã từ chối/spam vào Thùng Rác (khôi phục được).
// Cùng khuôn deleteTrainingClass() (module-internalcomms-daotao.js).
function deleteInternalPostAction(id) {
  const p = DB.internalPosts.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Xóa hẳn bài đăng "${p.title}"? Bài sẽ chuyển vào Thùng Rác (khôi phục được).`)) return;
  callRecordAction('internalPosts', id, 'delete', {}).then(() => {
    DB.internalPosts = DB.internalPosts.filter(x => x.id !== id);
    logSystemAction('INTERNAL', 'DELETE_INTERNAL_POST', `Xóa bài đăng [${p.code || ''} - ${p.title}]`, 'SUCCESS', p.code);
    closeInternalArticleModal();
    renderInternalPosts();
  }).catch(err => alert(`⛔ ${err.message}`));
}

// Gỡ Ghim (BỔ SUNG — phát hiện #11, rà soát chuyên sâu vòng 2, 9/2026) — cùng khuôn hideInternalPostAction()
// ở trên nhưng CHỈ đổi pinned/pinExpiresAt, KHÔNG đụng tới status (bài vẫn hiển thị bình thường, chỉ mất
// vị trí ghim ở trang chủ), khớp unpinInternalPost() ở lib/recordActions.js.
function unpinInternalPostAction(id) {
  const p = DB.internalPosts.find(x => x.id === id);
  if (!p) return;
  showConfirmModal({
    title: 'Gỡ ghim bài đăng',
    bodyHTML: `Bạn có chắc chắn muốn gỡ ghim bài "<b>${escapeHtml(p.title)}</b>" khỏi trang chủ?`,
    confirmLabel: 'Gỡ Ghim',
    onConfirm: async () => {
      let updated;
      try {
        const result = await callRecordAction('internalPosts', id, 'unpin', {});
        updated = result.item;
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const idx = DB.internalPosts.findIndex(x => x.id === id);
      if (idx !== -1) DB.internalPosts[idx] = updated;
      logSystemAction('INTERNAL', 'UNPIN_INTERNAL_POST', `Gỡ ghim bài [${updated.code} - ${updated.title}]`, 'SUCCESS', updated.code);
      closeInternalArticleModal();
      renderInternalPosts();
    }
  });
}

// "Yêu Cầu Bổ Sung" cho Góc Chia Sẻ (PENDING -> NEED_INFO) — cùng khuôn rejectInternalPostAction() bên
// dưới (prompt lý do bắt buộc) nhưng KHÔNG kết thúc bài, tác giả còn sửa lại gửi tiếp được (khác Từ
// chối, xem requestInternalPostInfo() ở lib/recordActions.js).
function requestInternalPostInfoAction(id) {
  const p = DB.internalPosts.find(x => x.id === id);
  if (!p) return;
  const comment = prompt('Nhập nội dung cần bổ sung/chỉnh sửa:');
  if (comment === null) return;
  if (!comment.trim()) return alert('⛔ Vui lòng nhập nội dung cần bổ sung!');
  showConfirmModal({
    title: 'Yêu cầu bổ sung',
    bodyHTML: `Bạn có chắc chắn muốn yêu cầu tác giả bổ sung bài "<b>${escapeHtml(p.title)}</b>"?<br><span class="text-xs text-gray-500">Nội dung: ${escapeHtml(comment.trim())}</span>`,
    confirmLabel: 'Yêu Cầu Bổ Sung',
    onConfirm: async () => {
      let updated;
      try {
        const result = await callRecordAction('internalPosts', id, 'request-info', { comment: comment.trim() });
        updated = result.item;
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const idx = DB.internalPosts.findIndex(x => x.id === id);
      if (idx !== -1) DB.internalPosts[idx] = updated;
      logSystemAction('INTERNAL', 'REQUEST_INFO_INTERNAL_POST', `Yêu cầu bổ sung bài Góc chia sẻ [${updated.code} - ${updated.title}] - ${comment.trim()}`, 'WARNING', updated.code);
      notifyUsersByEmail('INTERNAL', 'NOTIFY_NEED_INFO', updated.code, [updated.author],
        `[VPDT] Bài đăng "${updated.title}" cần bổ sung`,
        `Bài đăng Góc chia sẻ "${updated.title}" (${updated.code}) của bạn cần bổ sung trước khi duyệt.\nNội dung: ${comment.trim()}`);
      closeInternalArticleModal();
      renderInternalPosts();
      refreshApprovalSurfaces();
    }
  });
}

// ===== TUYỂN DỤNG (thay thế mục "Khen Thưởng" cũ) =====
// Khớp đúng lib/recordActions.js canManageRecruitment() ở server: admin hoặc có quyền
// internalRecruitmentCreate được đăng tin VÀ quản lý toàn bộ ứng viên (coi như "hộp thư chung" của bộ
// phận nhân sự, không giới hạn theo người đăng tin cụ thể). Chỉ dùng để ẩn/hiện UI — quyền THẬT vẫn do
// server tự kiểm tra lại ở mọi route (routes/records.js, lib/recordActions.js).
function canManageRecruitmentLocal(user) {
  return !!(user?.perms?.admin || user?.perms?.internalRecruitmentCreate);
}

const RECRUITMENT_STATUS_LABELS = { NEW: 'Mới', CONTACTED: 'Đã liên hệ', HIRED: 'Đã tuyển', REJECTED: 'Từ chối' };
const RECRUITMENT_STATUS_COLORS = { NEW: 'bg-gray-100 text-gray-700', CONTACTED: 'bg-blue-100 text-blue-700', HIRED: 'bg-emerald-100 text-emerald-700', REJECTED: 'bg-red-100 text-red-700' };

// ===== Đợt 2: Bản Tin Tuyển Dụng — 4 trạng thái hiển thị của TIN (khác 4 trạng thái ỨNG VIÊN ở trên) =====
// 3 trạng thái LƯU (OPEN/FILLED/CLOSED, xem lib/createValidation.js + closeRecruitmentJob()/
// confirmRecruitmentJobFilled() ở lib/recordActions.js) + 1 trạng thái TÍNH LIVE "Sắp hết hạn" (OPEN và
// deadline còn ≤7 ngày) — cùng tinh thần isInternalPostScheduled() ở trên: KHÔNG lưu field riêng, không
// cron, chỉ so Date.now() mỗi lần render nên luôn đúng thời điểm xem, không cần job nền cập nhật lại.
const RECRUITMENT_JOB_EXPIRING_SOON_DAYS = 7;
function isRecruitmentJobExpiringSoon(j) {
  if (j.status !== 'OPEN' || !j.deadline) return false;
  const deadlineMs = new Date(j.deadline + 'T23:59:59').getTime();
  if (isNaN(deadlineMs)) return false;
  const msPerDay = 24 * 60 * 60 * 1000;
  return (deadlineMs - Date.now()) <= RECRUITMENT_JOB_EXPIRING_SOON_DAYS * msPerDay;
}
function recruitmentJobStatusBadgeHTML(j) {
  if (j.status === 'FILLED') return `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">Đã tuyển đủ</span>`;
  if (j.status === 'CLOSED') return `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">Đã đóng tuyển dụng</span>`;
  if (isRecruitmentJobExpiringSoon(j)) return `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">⏳ Sắp hết hạn</span>`;
  return `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Đang tuyển</span>`;
}

function setRecruitmentTab(tab) {
  activeRecruitmentTab = tab;
  resetListPage('recruitmentJobs');
  resetListPage('recruitmentMyReferrals');
  resetListPage('recruitmentManage');
  renderRecruitment();
}

function renderRecruitment() {
  const canManage = canManageRecruitmentLocal(currentUser);
  document.getElementById('recruitmentJobForm').classList.toggle('hidden', !canManage);
  document.getElementById('recruitmentJobNoPermNote').classList.toggle('hidden', canManage);
  renderDynamicInputsForModule('RECRUITMENT_JOB', 'dynamicFieldsContainer_RECRUITMENT_JOB');
  // Mục 0 (10/2026): AND thêm checkbox internalRecruitmentJobs/MyReferrals/Manage.
  const permMap = { JOBS: 'internalRecruitmentJobs', MY_REFERRALS: 'internalRecruitmentMyReferrals', MANAGE: 'internalRecruitmentManage' };
  const allowedMap = { JOBS: hasModuleAccess(currentUser, permMap.JOBS), MY_REFERRALS: hasModuleAccess(currentUser, permMap.MY_REFERRALS), MANAGE: canManage && hasModuleAccess(currentUser, permMap.MANAGE) };
  if (!allowedMap[activeRecruitmentTab]) {
    activeRecruitmentTab = Object.keys(allowedMap).find(k => allowedMap[k]) || activeRecruitmentTab;
  }
  // Đồng bộ class active/hidden của cả 3 nút tab con — "Quản Lý Ứng Viên" chỉ HR mới thấy nút.
  const btnMap = { JOBS: 'btnRecruitmentJobs', MY_REFERRALS: 'btnRecruitmentMyReferrals', MANAGE: 'btnRecruitmentManage' };
  Object.entries(btnMap).forEach(([key, btnId]) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const active = key === activeRecruitmentTab;
    btn.className = (active ? 'px-3 py-1 rounded text-xs font-bold bg-amber-700 text-white' : 'px-3 py-1 rounded text-xs font-bold bg-gray-200 text-gray-700') + (allowedMap[key] ? '' : ' hidden');
  });
  document.getElementById('recruitmentJobsPanel').classList.toggle('hidden', activeRecruitmentTab !== 'JOBS');
  document.getElementById('recruitmentMyReferralsPanel').classList.toggle('hidden', activeRecruitmentTab !== 'MY_REFERRALS');
  document.getElementById('recruitmentManagePanel').classList.toggle('hidden', activeRecruitmentTab !== 'MANAGE');

  if (activeRecruitmentTab === 'JOBS') renderRecruitmentJobs();
  else if (activeRecruitmentTab === 'MY_REFERRALS') renderRecruitmentMyReferrals();
  else if (activeRecruitmentTab === 'MANAGE') renderRecruitmentManage();
}

let editingRecruitmentJobId = null;
async function submitRecruitmentJob(e) {
  e.preventDefault();
  if (!canManageRecruitmentLocal(currentUser)) return alert('⛔ Bạn không có quyền đăng tin tuyển dụng!');
  const editingJob = editingRecruitmentJobId ? DB.recruitmentJobs.find(j => j.id === editingRecruitmentJobId) : null;
  // Banner (tuỳ chọn) — đi qua uploadFileToServer(), KHÔNG dựng đường upload riêng. moduleKey
  // 'internalImage' (LỖI ĐÃ VÁ, đợt rà soát chuyên sâu upload 10/2026 — trước đây dùng chung 'internal'
  // với CV giới thiệu ứng viên/tệp văn bản khác, đụng độ với cấu hình "Loại Tệp Cho Phép" của admin cho
  // 'internal' — xem MODULE_DEFAULT_ALLOWED_EXT.internalImage ở routes/upload.js).
  const bannerFile = document.getElementById('rjBannerFile').files[0];
  // Đang sửa mà không chọn banner mới -> giữ nguyên banner cũ của tin (KHÔNG xoá).
  let bannerUrl = editingJob ? (editingJob.bannerUrl || '') : '';
  let bannerFileName = editingJob ? (editingJob.bannerFileName || '') : '';
  if (bannerFile) {
    try {
      const uploadedBanner = await uploadFileToServer(bannerFile, 'internalImage');
      bannerUrl = uploadedBanner.fileUrl;
      bannerFileName = uploadedBanner.fileName;
    } catch (err) {
      return alert(`⛔ Tải banner thất bại: ${err.message}`);
    }
  }
  let customData;
  try {
    customData = await collectDynamicFieldsData('RECRUITMENT_JOB');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const payload = {
    title: document.getElementById('rjTitle').value.trim(),
    description: document.getElementById('rjDescription').value.trim(),
    requirements: document.getElementById('rjRequirements').value.trim(),
    location: document.getElementById('rjLocation').value.trim(),
    slots: document.getElementById('rjSlots').value,
    deadline: document.getElementById('rjDeadline').value,
    month: document.getElementById('rjMonth').value,
    // Gửi lên KEY "hiringDept" (không phải "dept") — "dept" trên record này luôn bị server ép về đúng
    // phòng ban của người tạo (forceOwnDept, xem lib/createValidation.js), không phải đơn vị đăng tuyển.
    hiringDept: document.getElementById('rjDept').value,
    contactInfo: document.getElementById('rjContactInfo').value.trim(),
    income: document.getElementById('rjIncome').value.trim(),
    workTime: document.getElementById('rjWorkTime').value.trim(),
    bannerUrl, bannerFileName,
    customData
  };
  try {
    if (editingRecruitmentJobId) {
      const result = await callRecordAction('recruitmentJobs', editingRecruitmentJobId, 'edit', payload);
      const idx = DB.recruitmentJobs.findIndex(j => j.id === editingRecruitmentJobId);
      if (idx !== -1) DB.recruitmentJobs[idx] = result.item;
      logSystemAction('INTERNAL', 'EDIT_RECRUITMENT_JOB', `Sửa tin tuyển dụng [${result.item.title}]`, 'SUCCESS');
      alert('✅ Đã cập nhật tin tuyển dụng!');
      cancelEditRecruitmentJob();
    } else {
      const result = await callCreateAction('recruitmentJobs', payload);
      DB.recruitmentJobs.unshift(result.item);
      logSystemAction('INTERNAL', 'CREATE_RECRUITMENT_JOB', `Đăng tin tuyển dụng [${result.item.title}]`, 'SUCCESS');
      alert('✅ Đã đăng tin tuyển dụng thành công!');
      resetRecruitmentJobForm();
      resetListPage('recruitmentJobs');
    }
  } catch (err) { return alert(`⛔ ${err.message}`); }
  renderRecruitmentJobs();
}
// resetRecruitmentJobForm() — nút "↺ Làm Mới" (data-op="confirmAndResetForm" data-arg1=
// "resetRecruitmentJobForm", xem core.js) VÀ luồng đăng tin thành công ở trên. Hành vi cần GIỐNG HỆT
// cancelEditRecruitmentJob() (thoát Sửa dở dang nếu có + trắng form), cùng khuôn resetCareerPathForm().
function resetRecruitmentJobForm() {
  editingRecruitmentJobId = null;
  const formEl = document.getElementById('recruitmentJobForm');
  if (formEl) formEl.reset();
  clearSingleFileInput('rjBannerFile', 'rjBannerFileChip');
  const submitBtn = document.getElementById('rjSubmitBtn');
  if (submitBtn) submitBtn.innerText = 'Đăng Tin';
  const cancelBtn = document.getElementById('rjCancelEditBtn');
  if (cancelBtn) cancelBtn.classList.add('hidden');
}
function openEditRecruitmentJob(id) {
  const job = DB.recruitmentJobs.find(j => j.id === id);
  if (!job) return;
  editingRecruitmentJobId = id;
  document.getElementById('rjTitle').value = job.title || '';
  document.getElementById('rjDescription').value = job.description || '';
  document.getElementById('rjRequirements').value = job.requirements || '';
  document.getElementById('rjLocation').value = job.location || '';
  document.getElementById('rjSlots').value = job.slots || '';
  document.getElementById('rjDeadline').value = job.deadline || '';
  document.getElementById('rjMonth').value = job.month || '';
  document.getElementById('rjDept').value = job.hiringDept || '';
  document.getElementById('rjContactInfo').value = job.contactInfo || '';
  document.getElementById('rjIncome').value = job.income || '';
  document.getElementById('rjWorkTime').value = job.workTime || '';
  clearSingleFileInput('rjBannerFile', 'rjBannerFileChip');
  document.getElementById('rjSubmitBtn').innerText = 'Lưu Thay Đổi';
  document.getElementById('rjCancelEditBtn').classList.remove('hidden');
  document.getElementById('recruitmentJobForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function cancelEditRecruitmentJob() {
  resetRecruitmentJobForm();
}

// Đợt (Tháng) không phải danh mục cố định (mỗi tin tự nhập <input type=month>, xem rjMonth) — dropdown
// lọc lấy trực tiếp từ các giá trị month ĐÃ CÓ trong DB.recruitmentJobs, không cần bảng danh mục riêng.
function populateRecruitmentJobsMonthFilter() {
  const sel = document.getElementById('rjFilterMonth');
  if (!sel) return;
  const current = sel.value;
  const months = [...new Set((DB.recruitmentJobs || []).map(j => j.month).filter(Boolean))].sort().reverse();
  sel.innerHTML = '<option value="">-- Tất cả đợt --</option>' + months.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  if (months.includes(current)) sel.value = current;
}

// Vị trí đang tuyển (9/2026) — mirror ĐÚNG populateRecruitmentJobsMonthFilter() ngay trên: lấy các title
// KHÁC NHAU đã có trong DB.recruitmentJobs (sắp A-Z theo tiếng Việt), giữ lựa chọn hiện tại nếu còn hợp lệ.
function populateRecruitmentJobsTitleFilter() {
  const sel = document.getElementById('rjFilterTitle');
  if (!sel) return;
  const current = sel.value;
  const titles = [...new Set((DB.recruitmentJobs || []).map(j => (j.title || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
  sel.innerHTML = '<option value="">-- Tất cả vị trí --</option>' + titles.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  if (titles.includes(current)) sel.value = current;
}

// "🔥 Tin ưu tiên" — chỉ tính khi tin còn OPEN (xem pinRecruitmentJob() ở lib/recordActions.js).
function isRecruitmentJobPriority(j) {
  return !!(j && j.pinned && j.status === 'OPEN');
}

// Mô tả/Yêu cầu ẩn mặc định trên thẻ, mở/thu TẠI CHỖ (không modal) — nhớ id đang mở để render lại (lọc,
// phân trang, đẩy ưu tiên...) không tự đóng lại.
const expandedRecruitmentJobs = new Set();
// #internalRecruitmentSection là gốc bindCspDelegation() LỒNG bên trong gốc #internalSection (xem
// NESTED_CSP_ROOTS_IN_FRAGMENT ở core.js) nên 1 cú click trong danh sách tin được dispatch 2 LẦN (mỗi gốc 1
// lần) — hàm đồng bộ kiểu bật/tắt sẽ tự huỷ nhau, hàm có confirm() sẽ hỏi 2 lần. 3 nút MỚI dưới đây nhận
// kèm event (data-arg-event) và chỉ xử lý LẦN ĐẦU cho mỗi event — không đụng cơ chế dispatch chung.
function claimRecruitmentUiEventOnce(evt) {
  if (!evt) return true;
  if (evt.__rjHandled) return false;
  evt.__rjHandled = true;
  return true;
}
function toggleRecruitmentJobDetail(id, evt) {
  if (!claimRecruitmentUiEventOnce(evt)) return;
  const jobId = Number(id);
  if (expandedRecruitmentJobs.has(jobId)) expandedRecruitmentJobs.delete(jobId); else expandedRecruitmentJobs.add(jobId);
  const card = document.querySelector(`#recruitmentJobsContainer .rj-card[data-job-id="${jobId}"]`);
  if (!card) return;
  const open = expandedRecruitmentJobs.has(jobId);
  card.querySelector('.rj-detail')?.classList.toggle('hidden', !open);
  const btn = card.querySelector('[data-op="toggleRecruitmentJobDetail"]');
  if (btn) btn.textContent = open ? 'Thu gọn ▴' : 'Xem chi tiết ▾';
}

function pinRecruitmentJobUi(id, evt) {
  if (!claimRecruitmentUiEventOnce(evt)) return;
  if (!confirm('Đẩy ưu tiên tin tuyển dụng này? Tin sẽ nổi lên ĐẦU danh sách với nhãn "🔥 Tin ưu tiên".')) return;
  callRecordAction('recruitmentJobs', id, 'pin', {}).then(result => {
    const idx = DB.recruitmentJobs.findIndex(j => j.id === id);
    if (idx >= 0) DB.recruitmentJobs[idx] = result.item;
    logSystemAction('INTERNAL', 'PIN_RECRUITMENT_JOB', `Đẩy ưu tiên tin tuyển dụng [${result.item.title}]`, 'SUCCESS');
    renderRecruitmentJobs();
  }).catch(err => alert(`⛔ ${err.message}`));
}

function unpinRecruitmentJobUi(id, evt) {
  if (!claimRecruitmentUiEventOnce(evt)) return;
  if (!confirm('Bỏ đẩy ưu tiên tin tuyển dụng này?')) return;
  callRecordAction('recruitmentJobs', id, 'unpin', {}).then(result => {
    const idx = DB.recruitmentJobs.findIndex(j => j.id === id);
    if (idx >= 0) DB.recruitmentJobs[idx] = result.item;
    logSystemAction('INTERNAL', 'UNPIN_RECRUITMENT_JOB', `Bỏ đẩy ưu tiên tin tuyển dụng [${result.item.title}]`, 'SUCCESS');
    renderRecruitmentJobs();
  }).catch(err => alert(`⛔ ${err.message}`));
}

function onRecruitmentJobsFilterChange() {
  resetListPage('recruitmentJobs');
  renderRecruitmentJobs();
}

function renderRecruitmentJobs() {
  const container = document.getElementById('recruitmentJobsContainer');
  populateRecruitmentJobsMonthFilter();
  populateRecruitmentJobsTitleFilter();
  const filterTitle = document.getElementById('rjFilterTitle')?.value || '';
  const filterMonth = document.getElementById('rjFilterMonth')?.value || '';
  const filterDept = document.getElementById('rjFilterDept')?.value || '';
  const filterKeyword = (document.getElementById('rjFilterKeyword')?.value || '').trim();
  const filterStatus = document.getElementById('rjFilterStatus')?.value || '';
  // Tin "🔥 ưu tiên" nổi lên ĐẦU danh sách chính (đã chốt với người dùng: không tách khu riêng) — giữa các
  // tin ưu tiên, đẩy MỚI NHẤT (pinnedAt) đứng trước; phần còn lại giữ nguyên sort cũ theo id giảm dần.
  let list = (DB.recruitmentJobs || []).slice().sort((a, b) => {
    const pa = isRecruitmentJobPriority(a), pb = isRecruitmentJobPriority(b);
    if (pa !== pb) return pa ? -1 : 1;
    if (pa && pb) {
      const diff = (new Date(b.pinnedAt).getTime() || 0) - (new Date(a.pinnedAt).getTime() || 0);
      if (diff) return diff;
    }
    return b.id - a.id;
  }).filter(j => {
    if (filterTitle && (j.title || '').trim() !== filterTitle) return false;
    if (filterMonth && j.month !== filterMonth) return false;
    if (filterDept && j.hiringDept !== filterDept) return false;
    if (filterStatus && j.status !== filterStatus) return false;
    if (!matchesKeywordFields([j.title, j.location], filterKeyword)) return false;
    return true;
  });

  document.getElementById('paginationContainer_recruitmentJobs').innerHTML = buildPaginationBoxHTML('recruitmentJobs', 'renderRecruitmentJobs');
  const pageItems = paginateList('recruitmentJobs', list, 'renderRecruitmentJobs', 'tin tuyển dụng');

  if (!pageItems.length) { container.innerHTML = `<p class="text-gray-400 italic text-xs col-span-2">Chưa có tin tuyển dụng nào phù hợp.</p>`; return; }
  const canManage = canManageRecruitmentLocal(currentUser);
  container.innerHTML = pageItems.map(j => {
    const referrals = (DB.recruitmentReferrals || []).filter(r => r.jobId === j.id);
    const referralCount = referrals.length;
    const hiredCount = referrals.filter(r => r.status === 'HIRED').length;
    const isOpen = j.status === 'OPEN';
    const canClose = canManage && (j.status === 'OPEN' || j.status === 'FILLED');
    const statusBadge = recruitmentJobStatusBadgeHTML(j);
    const isPriority = isRecruitmentJobPriority(j);
    // Thẻ 2 cột (9/2026): TRÁI khung ảnh VUÔNG cố định, object-contain (không cắt méo banner như object-cover
    // cũ), placeholder trung tính khi không có banner; PHẢI các field chính dạng nhãn-giá trị IN ĐẬM.
    const thumbHTML = j.bannerUrl
      ? `<img src="${escapeHtml(j.bannerUrl)}" alt="${escapeHtml(j.title || '')}" loading="lazy" class="w-full h-full object-contain">`
      : `<span class="rj-thumb-placeholder text-3xl text-gray-300" aria-hidden="true">💼</span>`;
    const addressText = [j.location, j.hiringDept].filter(Boolean).join(' — ');
    const fieldRows = [
      ['Thu nhập', j.income || 'Thoả thuận'],
      ['Địa chỉ', addressText || '—'],
      ['Số lượng', j.slots > 0 ? `${j.slots} người` : 'Không giới hạn'],
      ['Thời hạn', j.deadline || 'Không thời hạn'],
      ['Liên hệ', j.contactInfo || '—']
    ];
    // Thời Gian Làm Việc (10/2026) — chỉ thêm dòng khi có nhập, tránh dư dòng "—" cho dữ liệu cũ trước
    // khi có field này (khớp cách currentHTML xử lý j.month ngay dưới).
    if (j.workTime) fieldRows.push(['Thời gian LV', j.workTime]);
    if (j.month) fieldRows.push(['Đợt tuyển', j.month]);
    const fieldsHTML = fieldRows.map(([label, value]) => `
            <div class="rj-field flex gap-1.5 text-xs">
              <dt class="rj-field-label text-gray-500 w-20 flex-shrink-0">${escapeHtml(label)}</dt>
              <dd class="rj-field-value font-bold text-gray-800 break-words min-w-0">${escapeHtml(value)}</dd>
            </div>`).join('');
    const detailOpen = expandedRecruitmentJobs.has(j.id);
    const hasDetail = !!(j.description || j.requirements);
    // Gợi ý "Đã tuyển đủ" khi referral HIRED đạt slots — CHỈ là banner gợi ý, nút xác nhận vẫn LUÔN bấm
    // được bất kể số này (HR có thể đã tuyển qua kênh ngoài hệ thống này không thấy được — đã chốt với
    // người yêu cầu tính năng, xem confirmRecruitmentJobFilled() ở lib/recordActions.js).
    const suggestFilledHTML = (canManage && isOpen && j.slots > 0 && hiredCount >= j.slots)
      ? `<p class="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-1">💡 Đã có ${hiredCount}/${j.slots} referral được tuyển — xác nhận đã tuyển đủ?</p>`
      : '';
    return `
      <div class="rj-card bg-white border ${isPriority ? 'border-amber-400 ring-1 ring-amber-300' : ''} rounded p-3 space-y-2" data-job-id="${Number(j.id)}">
        <div class="flex gap-3">
          <div class="rj-thumb w-24 h-24 sm:w-28 sm:h-28 flex-shrink-0 rounded border bg-gray-50 flex items-center justify-center overflow-hidden">${thumbHTML}</div>
          <div class="flex-1 min-w-0 space-y-1">
            <div class="flex justify-between items-start gap-2">
              <h4 class="font-bold text-gray-900 text-sm break-words">${escapeHtml(j.title)}</h4>
              <div class="flex flex-col items-end gap-1 flex-shrink-0">
                ${isPriority ? '<span class="rj-priority-badge text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">🔥 Tin ưu tiên</span>' : ''}
                ${statusBadge}
              </div>
            </div>
            <dl class="space-y-0.5">${fieldsHTML}</dl>
          </div>
        </div>
        ${hasDetail ? `
        <div class="rj-detail ${detailOpen ? '' : 'hidden'} border-t pt-2 space-y-1.5">
          ${j.description ? `<div class="text-xs"><div class="font-semibold text-gray-600">Mô tả công việc</div><p class="text-gray-700 whitespace-pre-wrap">${escapeHtml(j.description)}</p></div>` : ''}
          ${j.requirements ? `<div class="text-xs"><div class="font-semibold text-gray-600">Yêu cầu ứng viên</div><p class="text-gray-700 whitespace-pre-wrap">${escapeHtml(j.requirements)}</p></div>` : ''}
        </div>
        <button type="button" data-op="toggleRecruitmentJobDetail" data-arg0="${Number(j.id)}" data-arg-event="1" class="text-xs font-bold text-amber-700 hover:underline">${detailOpen ? 'Thu gọn ▴' : 'Xem chi tiết ▾'}</button>` : ''}
        <p class="text-[11px] text-gray-400">Đăng bởi ${escapeHtml(j.creatorName || j.creator)} · ${referralCount} lượt giới thiệu</p>
        ${suggestFilledHTML}
        <div class="flex gap-2 pt-1 flex-wrap">
          ${isOpen ? `<button data-op="openRecruitmentReferModal" data-arg0="${j.id}" class="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded text-xs font-bold">🙋 Giới Thiệu Ứng Viên</button>` : ''}
          ${canManage && isOpen && !j.pinned ? `<button data-op="pinRecruitmentJobUi" data-arg0="${j.id}" data-arg-event="1" class="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-3 py-1 rounded text-xs font-bold">🔥 Đẩy ưu tiên</button>` : ''}
          ${canManage && j.pinned ? `<button data-op="unpinRecruitmentJobUi" data-arg0="${j.id}" data-arg-event="1" class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded text-xs font-bold">Bỏ đẩy ưu tiên</button>` : ''}
          ${canManage && isOpen ? `<button data-op="confirmRecruitmentJobFilledUi" data-arg0="${j.id}" class="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded text-xs font-bold">✅ Xác Nhận Đã Tuyển Đủ</button>` : ''}
          ${canManage ? `<button data-op="openEditRecruitmentJob" data-arg0="${j.id}" class="bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1 rounded text-xs font-bold">✏️ Sửa</button>` : ''}
          ${canClose ? `<button data-op="closeRecruitmentJobUi" data-arg0="${j.id}" class="bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded text-xs font-bold">Đóng Tin</button>` : ''}
          ${currentUser.perms?.admin ? `<button data-op="deleteRecruitmentJob" data-arg0="${j.id}" class="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1 rounded text-xs font-bold">Xoá</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

function closeRecruitmentJobUi(id) {
  if (!confirm('Đóng tin tuyển dụng này? Sẽ không nhận thêm giới thiệu ứng viên mới.')) return;
  callRecordAction('recruitmentJobs', id, 'close', {}).then(result => {
    const idx = DB.recruitmentJobs.findIndex(j => j.id === id);
    if (idx >= 0) DB.recruitmentJobs[idx] = result.item;
    logSystemAction('INTERNAL', 'CLOSE_RECRUITMENT_JOB', `Đóng tin tuyển dụng [id ${id}]`, 'SUCCESS');
    renderRecruitmentJobs();
  }).catch(err => alert(`⛔ ${err.message}`));
}

// "Đã Tuyển Đủ" (Đợt 2) — xác nhận THỦ CÔNG, không chặn theo số referral HIRED (xem banner gợi ý ở
// renderRecruitmentJobs() + confirmRecruitmentJobFilled() ở lib/recordActions.js).
function confirmRecruitmentJobFilledUi(id) {
  if (!confirm('Xác nhận tin tuyển dụng này đã tuyển đủ? Tin sẽ chuyển sang trạng thái "Đã tuyển đủ".')) return;
  callRecordAction('recruitmentJobs', id, 'confirm-filled', {}).then(result => {
    const idx = DB.recruitmentJobs.findIndex(j => j.id === id);
    if (idx >= 0) DB.recruitmentJobs[idx] = result.item;
    logSystemAction('INTERNAL', 'CONFIRM_RECRUITMENT_JOB_FILLED', `Xác nhận đã tuyển đủ tin tuyển dụng [id ${id}]`, 'SUCCESS');
    renderRecruitmentJobs();
  }).catch(err => alert(`⛔ ${err.message}`));
}

function deleteRecruitmentJob(id) {
  if (!confirm('Xoá tin tuyển dụng này? Các ứng viên đã giới thiệu vẫn được giữ lại.')) return;
  callRecordAction('recruitmentJobs', id, 'delete', {}).then(() => {
    DB.recruitmentJobs = DB.recruitmentJobs.filter(j => j.id !== id);
    logSystemAction('INTERNAL', 'DELETE_RECRUITMENT_JOB', `Xoá tin tuyển dụng [id ${id}]`, 'SUCCESS');
    renderRecruitmentJobs();
  }).catch(err => alert(`⛔ ${err.message}`));
}

function openRecruitmentReferModal(jobId) {
  const job = (DB.recruitmentJobs || []).find(j => j.id === jobId);
  if (!job) return;
  resetRecruitmentReferForm();
  document.getElementById('rrJobId').value = jobId;
  document.getElementById('rrJobTitleLabel').innerText = job.title;
  document.getElementById('rrReferrerLabel').innerText = currentUser.name;
  renderDynamicInputsForModule('RECRUITMENT_REFERRAL', 'dynamicFieldsContainer_RECRUITMENT_REFERRAL');
  document.getElementById('recruitmentReferModal').classList.remove('hidden');
}

function closeRecruitmentReferModal() {
  document.getElementById('recruitmentReferModal').classList.add('hidden');
}
// resetRecruitmentReferForm() — nút "↺ Làm Mới" (data-op="confirmAndResetForm" data-arg1=
// "resetRecruitmentReferForm", xem core.js) VÀ mỗi lần mở modal ở trên (form luôn trắng lại khi mở cho 1
// tin tuyển dụng mới — factor ra đây tránh 2 nơi lệch nhau). #rrJobId là hidden input NẰM TRONG chính form
// này (khác mọi form khác trong hệ thống — editingXxxId luôn là biến JS ngoài form) nên form.reset() cũng
// xoá theo — PHẢI tự khôi phục lại giá trị đó (đọc trước, gán lại sau) để "↺ Làm Mới" giữa lúc đang điền
// dở KHÔNG làm mất luôn ngữ cảnh "đang giới thiệu ứng viên cho tin nào" (submit sau đó sẽ gửi jobId rỗng
// nếu không khôi phục). Ô này cũng đã đánh dấu readonly ở HTML để confirmAndResetForm() không tính nhầm
// là "đã có dữ liệu" chỉ vì modal đang mở (giá trị luôn khác rỗng ngay từ lúc mở, xem index.html).
function resetRecruitmentReferForm() {
  const jobId = document.getElementById('rrJobId').value;
  const formEl = document.getElementById('recruitmentReferForm');
  if (formEl) formEl.reset();
  document.getElementById('rrJobId').value = jobId;
  clearSingleFileInput('rrCvFile', 'rrCvFileChip');
}

async function submitRecruitmentReferral(e) {
  e.preventDefault();
  const jobId = Number(document.getElementById('rrJobId').value);
  const file = document.getElementById('rrCvFile').files[0];
  if (!file) return alert('Vui lòng tải lên CV của ứng viên!');
  let uploaded;
  try {
    uploaded = await uploadFileToServer(file, 'internal');
  } catch (err) {
    return alert(`⛔ Tải CV thất bại: ${err.message}`);
  }
  let customData;
  try {
    customData = await collectDynamicFieldsData('RECRUITMENT_REFERRAL');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const payload = {
    jobId,
    candidateName: document.getElementById('rrCandidateName').value.trim(),
    candidatePhone: document.getElementById('rrCandidatePhone').value.trim(),
    candidateEmail: document.getElementById('rrCandidateEmail').value.trim(),
    candidateNote: document.getElementById('rrCandidateNote').value.trim(),
    cvFileUrl: uploaded.fileUrl,
    cvFileName: uploaded.fileName,
    customData
  };
  let newReferral;
  try {
    const result = await callCreateAction('recruitmentReferrals', payload);
    newReferral = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  DB.recruitmentReferrals.unshift(newReferral);
  logSystemAction('INTERNAL', 'CREATE_RECRUITMENT_REFERRAL', `Giới thiệu ứng viên [${newReferral.candidateName}] cho vị trí [${newReferral.jobTitle}]`, 'SUCCESS');
  alert('✅ Đã gửi giới thiệu ứng viên, bộ phận nhân sự sẽ liên hệ ứng viên sớm nhất!');
  closeRecruitmentReferModal();
  renderRecruitmentJobs();
  if (activeRecruitmentTab === 'MY_REFERRALS') { resetListPage('recruitmentMyReferrals'); renderRecruitmentMyReferrals(); }
}

// Server đã tự lọc DB.recruitmentReferrals chỉ còn bản ghi của currentUser (nếu không phải HR) —
// xem lib/recordViewScope.js filterRecruitmentReferralsForUser() — nên ở đây không cần lọc lại theo
// referrerUsername, chỉ cần hiển thị nguyên những gì server đã trả về.
function renderRecruitmentMyReferrals() {
  const container = document.getElementById('recruitmentMyReferralsContainer');
  const canManage = canManageRecruitmentLocal(currentUser);
  const list = (DB.recruitmentReferrals || [])
    .filter(r => canManage ? r.referrerUsername === currentUser.username : true)
    .slice().sort((a, b) => b.id - a.id);

  document.getElementById('paginationContainer_recruitmentMyReferrals').innerHTML = buildPaginationBoxHTML('recruitmentMyReferrals', 'renderRecruitmentMyReferrals');
  const pageItems = paginateList('recruitmentMyReferrals', list, 'renderRecruitmentMyReferrals', 'ứng viên');

  if (!pageItems.length) { container.innerHTML = `<p class="text-gray-400 italic text-xs">Bạn chưa giới thiệu ứng viên nào.</p>`; return; }
  container.innerHTML = pageItems.map(r => `
    <div class="bg-white border rounded p-3 flex justify-between items-start gap-3">
      <div>
        <p class="font-bold text-gray-800 text-sm">${escapeHtml(r.candidateName)} <span class="font-normal text-gray-500">— ${escapeHtml(r.jobTitle)}</span></p>
        <p class="text-xs text-gray-500">${escapeHtml(r.candidatePhone)}${r.candidateEmail ? ' · ' + escapeHtml(r.candidateEmail) : ''}</p>
        ${r.candidateNote ? `<p class="text-xs text-gray-500 italic mt-1">${escapeHtml(r.candidateNote)}</p>` : ''}
        ${r.statusNote ? `<p class="text-xs text-blue-600 mt-1">📌 Phản hồi từ HR: ${escapeHtml(r.statusNote)}</p>` : ''}
      </div>
      <span class="text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${RECRUITMENT_STATUS_COLORS[r.status] || ''}">${RECRUITMENT_STATUS_LABELS[r.status] || r.status}</span>
    </div>`).join('');
}

function populateRecruitmentManageFilter() {
  const sel = document.getElementById('recruitmentManageFilterJob');
  if (!sel) return;
  const current = sel.value;
  const opts = (DB.recruitmentJobs || []).slice().sort((a, b) => b.id - a.id)
    .map(j => `<option value="${j.id}">${escapeHtml(j.title)}</option>`).join('');
  sel.innerHTML = `<option value="">-- Tất cả tin tuyển dụng --</option>` + opts;
  sel.value = current;
}

function onRecruitmentManageFilterChange() {
  resetListPage('recruitmentManage');
  renderRecruitmentManage();
}

function renderRecruitmentManage() {
  if (!canManageRecruitmentLocal(currentUser)) return;
  populateRecruitmentManageFilter();
  const tbody = document.getElementById('recruitmentManageTableBody');
  const filterJobId = document.getElementById('recruitmentManageFilterJob').value;
  let list = (DB.recruitmentReferrals || []).slice().sort((a, b) => b.id - a.id);
  if (filterJobId) list = list.filter(r => String(r.jobId) === filterJobId);

  document.getElementById('paginationContainer_recruitmentManage').innerHTML = buildPaginationBoxHTML('recruitmentManage', 'renderRecruitmentManage');
  const pageItems = paginateList('recruitmentManage', list, 'renderRecruitmentManage', 'ứng viên');

  if (!pageItems.length) { tbody.innerHTML = `<tr><td colspan="7" class="text-center p-4 text-gray-400 italic">Chưa có ứng viên nào được giới thiệu.</td></tr>`; return; }
  tbody.innerHTML = pageItems.map(r => `
    <tr>
      <td class="border p-2">${escapeHtml(r.candidateName)}</td>
      <td class="border p-2">${escapeHtml(r.candidatePhone)}${r.candidateEmail ? '<br>' + escapeHtml(r.candidateEmail) : ''}</td>
      <td class="border p-2">${escapeHtml(r.jobTitle)}</td>
      <td class="border p-2">${escapeHtml(r.referrerName || r.referrerUsername)}</td>
      <td class="border p-2">${r.cvFileUrl ? `<a href="${escapeHtml(r.cvFileUrl)}" target="_blank" class="text-indigo-600 font-bold hover:underline">📄 Xem CV</a>` : '-'}</td>
      <td class="border p-2"><span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${RECRUITMENT_STATUS_COLORS[r.status] || ''}">${RECRUITMENT_STATUS_LABELS[r.status] || r.status}</span></td>
      <td class="border p-2 text-center">
        <select data-op-change="setRecruitmentReferralStatusUi" data-arg0="${r.id}" data-arg-value="1" class="border p-1 rounded bg-white text-xs">
          ${Object.keys(RECRUITMENT_STATUS_LABELS).map(s => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${RECRUITMENT_STATUS_LABELS[s]}</option>`).join('')}
        </select>
      </td>
    </tr>`).join('');
}

function setRecruitmentReferralStatusUi(id, status) {
  const statusNote = prompt('Ghi chú thêm cho ứng viên (tuỳ chọn, để trống nếu không có):', '') || '';
  callRecordAction('recruitmentReferrals', id, 'set-status', { status, statusNote }).then(result => {
    const idx = DB.recruitmentReferrals.findIndex(r => r.id === id);
    if (idx >= 0) DB.recruitmentReferrals[idx] = result.item;
    logSystemAction('INTERNAL', 'SET_RECRUITMENT_REFERRAL_STATUS', `Cập nhật trạng thái ứng viên [id ${id}] -> ${status}`, 'SUCCESS');
    renderRecruitmentManage();
  }).catch(err => { alert(`⛔ ${err.message}`); renderRecruitmentManage(); });
}

// isInternalImageAttachment() đã CHUYỂN sang core.js (trang chủ cần gọi để hiện thumbnail tin — xem
// renderDashboardNews() ở core-dashboard.js, luôn nạp sẵn), cạnh getInternalPostCoverImage().

// "Tin tức" (NEWS) VÀ "Góc Chia Sẻ" (SHARE, từ Đợt E 9/2026) dùng chung khung hiển thị kiểu Facebook
// (renderInternalFeedStyle) — bình luận/thích ngay dưới bài, không cần mở "Chi tiết". Đào tạo/Tuyển dụng/
// HCRC Đồng Hành dùng khối riêng hẳn (usesOwnSection ở setInternalSubTab); phần còn lại của
// renderInternalPosts() (Facebook comment gần cuối file) chỉ còn phục vụ loại bài cũ không có tab active
// (VD REWARD còn sót trong dữ liệu cũ).
// Đợt E (9/2026): Góc Chia Sẻ nay dùng chung khung "kiểu Facebook" với Nhịp Sống HCRC (xem
// renderInternalFeedStyle() bên dưới) nên sắp xếp cũng tách riêng theo TỪNG loại (đổi "Tương tác nhiều"
// ở Góc Chia Sẻ không ảnh hưởng lựa chọn đang xem ở Nhịp Sống HCRC và ngược lại).
let internalFeedSortMode = { NEWS: 'recent', SHARE: 'recent' }; // 'recent' | 'popular'
function setInternalFeedSort(type, mode) {
  internalFeedSortMode[type] = mode;
  resetListPage(type === 'SHARE' ? 'internal' : 'internalNews');
  renderInternalPosts();
}

// ===================== Trạng thái đặc biệt (Đợt 1 Nhịp Sống HCRC/Góc Chia Sẻ) =====================
// Pill trạng thái dùng CHUNG cho danh sách thường (renderInternalPosts — Đào tạo/Khen thưởng), khung
// kiểu Facebook của Nhịp Sống HCRC/Góc Chia Sẻ (renderInternalFeedStyle/renderInternalNewsCard) và modal Chi tiết
// (viewInternalPostDetail) — PENDING/REJECTED đã có từ trước (Góc chia sẻ chờ/bị từ chối duyệt), bổ
// sung DRAFT/NEED_INFO/HIDDEN + "Chờ đăng" (APPROVED nhưng publishAt còn ở tương lai, tính LIVE theo
// Date.now(), KHÔNG cron — cùng cách pinExpiresAt đã tính ở renderDashboardNews()/render ở trên).
// isInternalPostScheduled() da chuyen sang core.js (Ha tang: nap module theo cum, dot 7) -
// renderDashboardNews() (core-dashboard.js, luon nap san) goi thang ham nay o MOI lan mo trang chu.

function internalPostStatusBadgeHTML(p) {
  const badge = (cls, text) => `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${cls} align-middle ml-2">${text}</span>`;
  if (p.status === 'DRAFT') return badge('bg-gray-200 text-gray-700', '📝 Nháp');
  if (p.status === 'NEED_INFO') return badge('bg-orange-100 text-orange-700', '✏️ Yêu Cầu Bổ Sung');
  if (p.status === 'HIDDEN') return badge('bg-slate-200 text-slate-700', '🙈 Đã Ẩn');
  if (p.status === 'PENDING') return badge('bg-amber-100 text-amber-700', '⏳ Chờ duyệt');
  if (p.status === 'REJECTED') return badge('bg-red-100 text-red-700', '❌ Bị từ chối');
  if (isInternalPostScheduled(p)) return badge('bg-sky-100 text-sky-700', '⏳ Chờ đăng');
  return '';
}

// Nút "Sửa" cho tác giả (hoặc admin) khi bài đang ở Nháp/Yêu cầu bổ sung — điều kiện khớp Y HỆT
// canEditInternalPostUI() (submitInternalPost() ở trên) để không lặp logic 2 nơi khác nhau.
function internalPostEditButtonHTML(p) {
  if (!canEditInternalPostUI(p)) return '';
  return `<button data-op="editInternalPostUI" data-arg0="${p.id}" class="bg-blue-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-blue-700">✏️ Sửa</button>`;
}

// Banner hiện lý do "Yêu cầu bổ sung" của người duyệt ngay phía trên bài — giúp tác giả biết cần sửa gì
// trước khi bấm Sửa/gửi lại (chỉ Góc chia sẻ có trạng thái NEED_INFO, xem requestInternalPostInfo() ở
// lib/recordActions.js).
function internalPostInfoRequestBannerHTML(p) {
  if (p.status !== 'NEED_INFO' || !p.infoRequestComment) return '';
  return `<div class="bg-orange-50 border border-orange-200 rounded p-2 mb-2 text-xs text-orange-800"><b>Yêu cầu bổ sung từ người duyệt:</b> ${escapeHtml(p.infoRequestComment)}</div>`;
}

// Ẩn/Hiện lại (Admin) — chỉ canApproveInternalPost, APPROVED<->HIDDEN, mọi type (khớp
// hideInternalPost()/unhideInternalPost() ở lib/recordActions.js).
function internalPostHideActionHTML(p) {
  if (!canApproveInternalPost(currentUser)) return '';
  if (p.status === 'APPROVED') return `<button data-op="hideInternalPostAction" data-arg0="${p.id}" class="bg-slate-500 text-white px-3 py-1 rounded text-xs font-bold hover:bg-slate-600">🙈 Ẩn</button>`;
  if (p.status === 'HIDDEN') return `<button data-op="unhideInternalPostAction" data-arg0="${p.id}" class="bg-emerald-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-emerald-700">👁️ Hiện Lại</button>`;
  return '';
}

// Gỡ Ghim (phát hiện #11) — chỉ hiện khi bài ĐANG ghim còn hạn (cùng điều kiện pinBadgeHTML ở
// renderInternalPosts()), cùng quyền canApproveInternalPost như internalPostHideActionHTML() ở trên.
function internalPostUnpinActionHTML(p) {
  if (!canApproveInternalPost(currentUser)) return '';
  if (!(p.pinned && p.pinExpiresAt && new Date(p.pinExpiresAt).getTime() > Date.now())) return '';
  return `<button data-op="unpinInternalPostAction" data-arg0="${p.id}" class="bg-amber-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-amber-700">📌 Gỡ Ghim</button>`;
}

// Xoá bài (phát hiện #12) — CHỈ Admin, khớp POST internalPosts/:id/delete (admin-only) ở routes/records.js.
function internalPostDeleteActionHTML(p) {
  if (!currentUser.perms?.admin) return '';
  return `<button data-op="deleteInternalPostAction" data-arg0="${p.id}" class="text-red-500 font-bold hover:underline text-xs px-1">Xóa</button>`;
}

// "Yêu Cầu Bổ Sung" (chỉ Góc chia sẻ, PENDING, canApprove) — hiện cạnh Duyệt/Từ chối hiện có.
function internalPostRequestInfoActionHTML(p) {
  if (p.type !== 'SHARE' || p.status !== 'PENDING' || !canApproveInternalPost(currentUser)) return '';
  return `<button data-op="requestInternalPostInfoAction" data-arg0="${p.id}" class="bg-orange-500 text-white px-3 py-1 rounded text-xs font-bold hover:bg-orange-600">✏️ Yêu Cầu Bổ Sung</button>`;
}

// ===================== Reaction bình luận + xếp hạng "3-5 bình luận nổi bật" (Đợt 1) =====================
// expandedInternalComments: id các bài đang bấm "Xem tất cả bình luận" (client-only, mất khi tải lại
// trang — không cần nhớ lâu dài, chỉ để không phải bấm lại khi render() lại nhiều lần trong 1 phiên).
const expandedInternalComments = new Set();
function toggleInternalCommentsExpanded(id) {
  if (expandedInternalComments.has(id)) expandedInternalComments.delete(id);
  else expandedInternalComments.add(id);
  renderInternalPosts();
}

// Wrapper cho CSP: nút "Xem tất cả/Thu gọn bình luận" trong modal chi tiết gọi 2 hàm liên tiếp
// (toggleInternalCommentsExpanded + viewInternalPostDetail) với arg ${p.id} là biểu thức template
// literal chứ không phải literal thuần -> không đủ điều kiện dùng data-op-seq, gộp thành 1 hàm.
function toggleInternalCommentsExpandedAndView(id) {
  toggleInternalCommentsExpanded(id);
  viewInternalPostDetail(id);
}

// Wrapper cho CSP: nút "Bình luận" trên card feed vốn gọi trực tiếp biểu thức
// document.getElementById(...).focus() (không phải lời gọi hàm đơn) -> không khớp data-op="fn(args)",
// bọc lại thành hàm đặt tên để bindCspDelegation dispatch được.
function focusInternalCommentInput(id) {
  document.getElementById('internalCommentInput_' + id)?.focus();
}

function toggleInternalCommentLike(postId, commentId) {
  const p = DB.internalPosts.find(x => x.id === postId);
  const c = (p?.comments || []).find(x => x.id === commentId);
  if (!c) return;
  if (!Array.isArray(c.likes)) c.likes = [];
  const idx = c.likes.indexOf(currentUser.username);
  if (idx === -1) c.likes.push(currentUser.username); else c.likes.splice(idx, 1);
  callRecordAction('internalPosts', postId, `comment/${commentId}/like`, {}).catch(err => console.error('Lỗi cập nhật lượt thích bình luận:', err.message));
  renderInternalPosts();
}

function internalCommentLikeButtonHTML(postId, c) {
  const likes = c.likes || [];
  const liked = likes.includes(currentUser.username);
  return `<button data-op="toggleInternalCommentLike" data-arg0="${postId}" data-arg1="${c.id}" class="text-[11px] font-bold ${liked ? 'text-fuchsia-700' : 'text-gray-400 hover:text-gray-600'}">${liked ? '❤️' : '🤍'}${likes.length ? ' ' + likes.length : ''}</button>`;
}

// Tác giả tự sửa/xoá ĐÚNG bình luận của chính mình (editInternalPostComment()/deleteInternalPostComment()
// ở lib/recordActions.js — server tự kiểm tra lại comment.username === user.username, đây chỉ là điều
// kiện hiện nút, không phải hàng rào bảo mật thật) — chỉ hiện khi KHÔNG phải bình luận của người khác.
function internalCommentOwnActionsHTML(postId, c) {
  if (c.username !== currentUser.username) return '';
  return `<button data-op="editOwnInternalComment" data-arg0="${postId}" data-arg1="${c.id}" class="text-[11px] font-bold text-gray-400 hover:text-gray-600">Sửa</button>` +
    `<button data-op="deleteOwnInternalComment" data-arg0="${postId}" data-arg1="${c.id}" class="text-[11px] font-bold text-gray-400 hover:text-red-600">Xoá</button>`;
}

async function editOwnInternalComment(postId, commentId) {
  const p = DB.internalPosts.find(x => x.id === postId);
  const c = (p?.comments || []).find(x => x.id === commentId);
  if (!c) return;
  const content = prompt('Sửa bình luận:', c.content);
  if (content === null) return;
  if (!content.trim()) return alert('⛔ Nội dung bình luận không được để trống');
  let updated;
  try {
    const result = await callRecordAction('internalPosts', postId, `comment/${commentId}/edit`, { content: content.trim() });
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const idx = DB.internalPosts.findIndex(x => x.id === postId);
  if (idx !== -1) DB.internalPosts[idx] = updated;
  renderInternalPosts();
}

function deleteOwnInternalComment(postId, commentId) {
  if (!confirm('Xoá bình luận này của bạn? Không thể hoàn tác.')) return;
  (async () => {
    let updated;
    try {
      const result = await callRecordAction('internalPosts', postId, `comment/${commentId}/delete-comment`, {});
      updated = result.item;
    } catch (err) {
      return alert(`⛔ ${err.message}`);
    }
    const idx = DB.internalPosts.findIndex(x => x.id === postId);
    if (idx !== -1) DB.internalPosts[idx] = updated;
    renderInternalPosts();
  })();
}

// "3-5 bình luận nổi bật": tối đa 2 bình luận MỚI NHẤT (theo id, id = Date.now() lúc gửi) + tối đa 3
// bình luận NHIỀU LƯỢT THÍCH NHẤT (likes.length) — gộp lại, khử trùng (1 bình luận vừa mới vừa nhiều
// thích chỉ tính 1 lần, tổng tự nhiên tối đa 5), rồi giữ lại ĐÚNG THỨ TỰ THỜI GIAN gốc của mảng
// comments[] để không xáo trộn luồng đọc. Tính THUẦN Ở CLIENT mỗi lần render (không cache) — mảng
// comments[] đầy đủ (server đã lọc pendingModeration, xem sanitizeInternalPostCommentsForUser() ở
// lib/recordViewScope.js) đã có sẵn, không cần gọi API riêng.
function pickHighlightedComments(comments) {
  if (comments.length <= 5) return comments.slice();
  const byRecent = comments.slice().sort((a, b) => b.id - a.id).slice(0, 2);
  const byLikes = comments.slice().sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0)).slice(0, 3);
  const keepIds = new Set([...byRecent, ...byLikes].map(c => c.id));
  return comments.filter(c => keepIds.has(c.id));
}

// Hàng đợi kiểm duyệt (bình luận pendingModeration) — CHỈ approver mới nhận được các bình luận này từ
// server (comments[] đã lọc hẳn khỏi người khác, xem sanitizeInternalPostCommentsForUser()), nên không
// còn hiện lẫn trong khung bình luận công khai như trước (Bỏ qua/Xoá dùng lại đúng
// dismissCommentFlagAction()/deleteFlaggedCommentAction() đã có).
function renderInternalModerationQueueHTML(p) {
  if (!canApproveInternalPost(currentUser)) return '';
  const pending = (p.comments || []).filter(c => c.pendingModeration);
  if (!pending.length) return '';
  const isSevere = c => (c.flagCategories || []).some(cat => SENSITIVE_CATEGORY_SEVERE.has(cat));
  return `
    <div class="bg-amber-50 border border-amber-200 rounded p-2 mb-2 space-y-1.5">
      <div class="text-xs font-bold text-amber-800">⚠️ ${pending.length} bình luận chờ kiểm duyệt</div>
      ${pending.map(c => `
        <div class="bg-white border rounded p-2 text-xs">
          <div class="font-bold text-gray-700">${escapeHtml(c.name || '')} <span class="text-gray-400 font-normal">${escapeHtml(c.time || '')}</span></div>
          <div class="text-gray-800 mt-0.5">${escapeHtml(c.content)}</div>
          <div class="mt-1 flex flex-wrap items-center gap-1.5">
            <span class="px-1.5 py-0.5 rounded-full font-bold ${isSevere(c) ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}">${isSevere(c) ? '🚨' : '⚠️'} ${(c.flagCategories || []).map(cat => SENSITIVE_CATEGORY_LABELS[cat] || cat).join(', ')}</span>
            <button data-op="dismissCommentFlagAction" data-arg0="${p.id}" data-arg1="${c.id}" class="text-emerald-700 font-bold hover:underline">Bỏ qua</button>
            <button data-op="deleteFlaggedCommentAction" data-arg0="${p.id}" data-arg1="${c.id}" class="text-red-700 font-bold hover:underline">Xoá</button>
          </div>
        </div>
      `).join('')}
    </div>`;
}

function renderInternalPosts() {
  // Đợt E (9/2026): Góc Chia Sẻ nay dùng chung khung "kiểu Facebook" với Nhịp Sống HCRC (bình luận/thích
  // ngay trên bài, top 5 bình luận nổi bật, sắp theo tương tác, kiểm duyệt bình luận inline) thay vì chỉ
  // liệt kê tĩnh như trước — xem renderInternalFeedStyle() bên dưới, giữ nguyên dashboard/lọc trạng thái
  // riêng cho SHARE bên trong hàm đó.
  if (activeInternalSubTab === 'NEWS' || activeInternalSubTab === 'SHARE') return renderInternalFeedStyle(activeInternalSubTab);
  const container = document.getElementById('internalPostsContainer');
  if (!container) return;
  // Khối phân trang riêng của Nhịp Sống HCRC ('internalNews') không dùng ở đây — dọn sạch nếu còn sót
  // lại từ lúc đang ở tab NEWS.
  const newsPaginationEl = document.getElementById('paginationContainer_internalNews');
  if (newsPaginationEl) newsPaginationEl.innerHTML = '';

  const fromDate = document.getElementById('filterFromDateInternal')?.value || '';
  const toDate = document.getElementById('filterToDateInternal')?.value || '';
  const keyword = (document.getElementById('filterKeywordInternal')?.value || '').trim();

  // NEWS/SHARE đã chuyển sang renderInternalFeedStyle() ở trên (kể cả ô lọc trạng thái + dashboard riêng
  // của SHARE) — nhánh còn lại của hàm này chỉ còn phục vụ loại bài KHÔNG có quy trình PENDING/APPROVED
  // (VD REWARD còn sót trong dữ liệu cũ, hiện không còn nút tab tạo mới), nên luôn ẩn ô lọc trạng thái +
  // dọn sạch dashboard.
  document.getElementById('internalStatusFilterWrap')?.classList.add('hidden');
  const statusFilter = '';
  const canApprove = canApproveInternalPost(currentUser);
  document.getElementById('internalDashboardCards')?.replaceChildren();

  const visible = DB.internalPosts.filter(p => {
    if (p.type !== activeInternalSubTab) return false;
    // Bài KHÔNG phải APPROVED (PENDING/REJECTED/DRAFT/NEED_INFO/HIDDEN) chỉ hiện với chính tác giả và
    // người có quyền duyệt — status undefined (bài cũ trước khi có tính năng này) coi như đã duyệt, vẫn
    // hiện bình thường. Server đã lọc trước (chỉ trả về bài mình được xem, xem canViewInternalPost() ở
    // lib/recordViewScope.js) — kiểm tra lại ở đây chỉ để phòng hờ, không phải nguồn xác thực chính.
    const isRestrictedStatus = p.status && p.status !== 'APPROVED';
    if (isRestrictedStatus && p.author !== currentUser.username && !canApprove) return false;
    if (statusFilter && (p.status || 'APPROVED') !== statusFilter) return false;
    if (!isInDateRange(p.createdAt, fromDate, toDate)) return false;
    if (!matchesKeywordFields([p.title, internalPostPlainText(p), p.authorName, p.dept], keyword)) return false;
    return true;
  });

  document.getElementById('paginationContainer_internal').innerHTML = buildPaginationBoxHTML('internal', 'renderInternalPosts');
  const pageItems = paginateList('internal', visible, 'renderInternalPosts', 'bài đăng');

  if (pageItems.length === 0) {
    container.innerHTML = `<div class="text-center p-6 text-gray-500 italic bg-white rounded border">Chưa có bài đăng nào phù hợp.</div>`;
    return;
  }

  container.innerHTML = pageItems.map(p => {
    const readCount = (p.readBy || []).length;
    const likeCount = (p.likes || []).length;
    const commentCount = (p.comments || []).length;
    let extraInfo = '';
    if (p.type === 'TRAINING' && p.training) {
      const regCount = (p.training.registeredUsers || []).length;
      extraInfo = `<div class="text-xs text-emerald-700 mt-1">🗓️ ${escapeHtml(p.training.startTime || '')} tại ${escapeHtml(p.training.location || 'N/A')} | Đã đăng ký: ${regCount}${p.training.capacity ? '/' + p.training.capacity : ''}</div>`;
    }
    if (p.type === 'REWARD' && p.reward) {
      extraInfo = `<div class="text-xs text-amber-700 mt-1">🏆 ${escapeHtml(p.reward.period || '')} — ${escapeHtml(p.reward.recipients || '')}</div>`;
    }
    const plain = internalPostPlainText(p);
    const snippet = plain.slice(0, 200);
    const legacyCover = getInternalPostCoverImage(p);
    const coverThumbHTML = legacyCover
      ? `<img src="${escapeHtml(legacyCover.fileUrl)}" alt="" class="w-full sm:w-48 h-40 sm:h-auto object-cover cursor-pointer flex-shrink-0" data-op="viewInternalPostDetail" data-arg0="${p.id}">`
      : '';
    const statusBadgeHTML = internalPostStatusBadgeHTML(p);
    // Ghim lên trang chủ (Đợt E) — chỉ hiện badge khi CÒN hạn (pinExpiresAt tương lai), không hiện lại
    // cho bài đã hết hạn ghim dù field pinned vẫn còn true trong dữ liệu cũ.
    const pinBadgeHTML = (p.pinned && p.pinExpiresAt && new Date(p.pinExpiresAt).getTime() > Date.now())
      ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 align-middle ml-2">📌 Đã ghim trang chủ</span>`
      : '';
    const approveActionsHTML = (p.status === 'PENDING' && canApprove)
      ? `<div class="flex gap-2 flex-wrap">
           <button data-op="approveInternalPostAction" data-arg0="${p.id}" class="bg-emerald-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-emerald-700">✅ Duyệt</button>
           <button data-op="rejectInternalPostAction" data-arg0="${p.id}" class="bg-red-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-red-700">❌ Từ chối</button>
           ${internalPostRequestInfoActionHTML(p)}
         </div>`
      : '';
    return `
      <div class="bg-white rounded border hover:shadow overflow-hidden flex flex-col sm:flex-row">
        ${coverThumbHTML}
        <div class="p-4 flex-1 flex flex-col">
          <div class="font-bold text-fuchsia-800 text-base cursor-pointer hover:underline" data-op="viewInternalPostDetail" data-arg0="${p.id}">${escapeHtml(p.title)}</div>
          <div class="mt-1">${statusBadgeHTML}${pinBadgeHTML}</div>
          <div class="text-xs text-gray-500 mt-0.5">${escapeHtml(p.authorName)} (${escapeHtml(p.dept)}) — ${escapeHtml(p.createdAt)}</div>
          ${internalPostInfoRequestBannerHTML(p)}
          <p class="text-sm text-gray-700 mt-2 flex-1">${escapeHtml(snippet)}${plain.length > 200 ? '…' : ''}</p>
          ${extraInfo}
          <div class="flex flex-wrap justify-between items-center gap-2 mt-3">
            <div class="flex gap-4 text-xs text-gray-500">
              <span>❤️ ${likeCount}</span>
              <span>💬 ${commentCount}</span>
              <span>👁️ ${readCount} đã xem</span>
            </div>
            <div class="flex gap-2 flex-wrap">
              ${approveActionsHTML}
              ${internalPostUnpinActionHTML(p)}
              ${internalPostHideActionHTML(p)}
              ${internalPostEditButtonHTML(p)}
              <button data-op="viewInternalPostDetail" data-arg0="${p.id}" class="bg-fuchsia-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-fuchsia-700">📄 Chi tiết</button>
              ${internalPostDeleteActionHTML(p)}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Khung "Tin tức" kiểu Facebook: chỉ 5 bài mới nhất (id = Date.now() lúc tạo — dùng trực tiếp để so
// "mới nhất", không cần parse lại chuỗi createdAt tiếng Việt), có thể đổi sang sắp theo tổng tương tác
// (thích + bình luận). Mỗi bài có khung bình luận + nút thích NGAY DƯỚI bài — dùng lại nguyên các action
// 'like'/'comment' đã có sẵn ở server (lib/recordActions.js), không cần đường API mới. "Chi tiết" (mở
// modal đầy đủ) vẫn giữ nguyên, không đụng tới.
function renderInternalFeedStyle(type) {
  const container = document.getElementById('internalPostsContainer');
  if (!container) return;
  const isShare = type === 'SHARE';
  // Góc Chia Sẻ tiếp tục dùng khối phân trang 'internal' (moduleKey + container id) đã có sẵn từ trước
  // (không cần thêm gì ở HTML) — Nhịp Sống HCRC dùng khối 'internalNews' riêng. Dọn sạch khối KHÔNG dùng
  // ở lượt render này (có thể còn sót lại từ tab kia, NEWS<->SHARE).
  const paginationKey = isShare ? 'internal' : 'internalNews';
  const paginationElId = isShare ? 'paginationContainer_internal' : 'paginationContainer_internalNews';
  const otherPaginationEl = document.getElementById(isShare ? 'paginationContainer_internalNews' : 'paginationContainer_internal');
  if (otherPaginationEl) otherPaginationEl.innerHTML = '';

  const fromDate = document.getElementById('filterFromDateInternal')?.value || '';
  const toDate = document.getElementById('filterToDateInternal')?.value || '';
  const keyword = (document.getElementById('filterKeywordInternal')?.value || '').trim();

  // Chỉ Góc Chia Sẻ mới có ô lọc trạng thái + dashboard PENDING/APPROVED/REJECTED (giữ nguyên hành vi cũ
  // của renderInternalPosts() trước Đợt E — Nhịp Sống HCRC không đổi UI, vẫn không có 2 khối này).
  const statusFilterWrap = document.getElementById('internalStatusFilterWrap');
  if (statusFilterWrap) statusFilterWrap.classList.toggle('hidden', !isShare);
  const statusFilter = isShare ? (document.getElementById('filterStatusInternal')?.value || '') : '';
  // Lọc theo chuyên đề (9/2026) — client-side trên DB.internalPosts đã tải, xem populateInternalCategoryFilter().
  const categoryFilter = document.getElementById('filterCategoryInternal')?.value || '';

  const canApprove = canApproveInternalPost(currentUser);
  const dashEl = document.getElementById('internalDashboardCards');
  if (isShare) {
    const scopedShare = DB.internalPosts.filter(p => p.type === 'SHARE' &&
      (!p.status || p.status === 'APPROVED' || p.author === currentUser.username || canApprove));
    const internalDashCards = [
      { key: '', label: 'Tổng Bài Đăng', count: scopedShare.length, colorClass: 'border-l-blue-500' },
      { key: 'PENDING', label: 'Đang Chờ Duyệt', count: scopedShare.filter(p => p.status === 'PENDING').length, colorClass: 'border-l-yellow-500' },
      { key: 'APPROVED', label: 'Đã Duyệt', count: scopedShare.filter(p => !p.status || p.status === 'APPROVED').length, colorClass: 'border-l-green-500' },
      { key: 'REJECTED', label: 'Từ Chối', count: scopedShare.filter(p => p.status === 'REJECTED').length, colorClass: 'border-l-red-500' }
    ];
    if (dashEl) dashEl.innerHTML = buildDashboardCardsHTML(internalDashCards, statusFilter, 'filterInternalByCard');
  } else if (dashEl) {
    dashEl.innerHTML = '';
  }

  let visible = DB.internalPosts.filter(p => {
    if (p.type !== type) return false;
    // Bài KHÔNG phải APPROVED (Nháp/Chờ duyệt/Yêu cầu bổ sung/Đã ẩn/Bị từ chối) chỉ hiện với chính tác
    // giả/người có quyền duyệt — cùng khuôn renderInternalPosts() (server đã lọc trước, đây chỉ phòng hờ).
    const isRestrictedStatus = p.status && p.status !== 'APPROVED';
    if (isRestrictedStatus && p.author !== currentUser.username && !canApprove) return false;
    if (statusFilter && (p.status || 'APPROVED') !== statusFilter) return false;
    if (categoryFilter && p.postCategory !== categoryFilter) return false;
    if (!isInDateRange(p.createdAt, fromDate, toDate)) return false;
    if (!matchesKeywordFields([p.title, internalPostPlainText(p), p.authorName, p.dept], keyword)) return false;
    return true;
  });

  visible = visible.slice().sort((a, b) => {
    if (internalFeedSortMode[type] === 'popular') {
      const scoreA = (a.likes?.length || 0) + (a.comments?.length || 0);
      const scoreB = (b.likes?.length || 0) + (b.comments?.length || 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
    }
    return b.id - a.id; // mới nhất trước
  });

  // TRƯỚC ĐÂY (NEWS): cắt cứng 5 bài mới nhất, không phân trang — nay phân trang đầy đủ như mọi danh
  // sách khác trong hệ thống, sắp xếp (Mới nhất/Tương tác nhiều) áp dụng TRƯỚC khi cắt trang. Nút phân
  // trang gọi lại renderInternalPosts() (dispatcher chung) thay vì gọi thẳng hàm này — dispatcher tự xét
  // đúng activeInternalSubTab hiện tại để redirect vào đây với đúng type.
  document.getElementById(paginationElId).innerHTML = buildPaginationBoxHTML(paginationKey, 'renderInternalPosts');
  const pageItems = paginateList(paginationKey, visible, 'renderInternalPosts', 'bài viết');

  const sortBarHTML = `
    <div class="flex items-center justify-between mb-3">
      <div class="text-xs text-gray-500">Tổng ${visible.length} ${isShare ? 'bài' : 'tin'}</div>
      <div class="flex gap-1">
        <button data-op="setInternalFeedSort" data-arg0="${type}" data-arg1="recent" class="px-2.5 py-1 rounded text-xs font-bold ${internalFeedSortMode[type] === 'recent' ? 'bg-fuchsia-700 text-white' : 'bg-gray-200 text-gray-700'}">🕐 Mới nhất</button>
        <button data-op="setInternalFeedSort" data-arg0="${type}" data-arg1="popular" class="px-2.5 py-1 rounded text-xs font-bold ${internalFeedSortMode[type] === 'popular' ? 'bg-fuchsia-700 text-white' : 'bg-gray-200 text-gray-700'}">🔥 Tương tác nhiều</button>
      </div>
    </div>`;

  if (pageItems.length === 0) {
    container.innerHTML = sortBarHTML + `<div class="text-center p-6 text-gray-500 italic bg-white rounded border">Chưa có ${isShare ? 'bài đăng' : 'tin tức'} nào phù hợp.</div>`;
    return;
  }

  container.innerHTML = sortBarHTML + pageItems.map(p => renderInternalNewsCard(p)).join('');
}

function renderInternalNewsCard(p) {
  const liked = (p.likes || []).includes(currentUser.username);
  const likeCount = (p.likes || []).length;
  // pendingModeration đã bị server LOẠI HẲN khỏi comments[] cho người không có quyền duyệt (xem
  // sanitizeInternalPostCommentsForUser() ở lib/recordViewScope.js) — với approver thì các bình luận
  // này VẪN có mặt ở đây nhưng không còn hiện lẫn trong khung công khai như trước, tách riêng qua
  // renderInternalModerationQueueHTML() bên dưới.
  const comments = (p.comments || []).filter(c => !c.pendingModeration);
  const expanded = expandedInternalComments.has(p.id);
  const shownComments = expanded ? comments : pickHighlightedComments(comments);
  // Ảnh bìa thẻ feed: getInternalPostCoverImage() (core.js) — coverImage/images[0] của bài mới, lùi về
  // attachment ảnh của bài cũ (y hệt hành vi cũ). Bài có nhiều ảnh/video hiện thêm nhãn đếm nhỏ ở góc.
  const cover = getInternalPostCoverImage(p);
  const imageCount = Array.isArray(p.images) ? p.images.length : 0;
  const videoCount = Array.isArray(p.videos) ? p.videos.length : 0;
  const mediaCountHTML = (imageCount > 1 || videoCount > 0)
    ? `<span class="internal-media-count absolute bottom-2 right-2 bg-black bg-opacity-60 text-white text-[11px] font-bold px-2 py-0.5 rounded">${imageCount > 1 ? `🖼️ ${imageCount}` : ''}${imageCount > 1 && videoCount ? ' · ' : ''}${videoCount ? `🎬 ${videoCount}` : ''}</span>`
    : '';
  const coverHTML = cover
    ? `<div class="relative"><img src="${escapeHtml(cover.fileUrl)}" alt="" class="w-full max-h-80 object-cover cursor-pointer" data-op="viewInternalPostDetail" data-arg0="${p.id}">${mediaCountHTML}</div>`
    : (videoCount ? `<div class="relative bg-gray-900 text-white text-sm text-center py-6 cursor-pointer" data-op="viewInternalPostDetail" data-arg0="${p.id}">🎬 Bài viết có ${videoCount} video — bấm để xem</div>` : '');
  const plain = internalPostPlainText(p);
  const snippet = plain.slice(0, 300);
  const commentsHTML = shownComments.length
    ? shownComments.map(c => `
        <div class="flex gap-2 text-sm">
          <div class="w-7 h-7 rounded-full bg-fuchsia-200 text-fuchsia-800 flex items-center justify-center font-bold text-xs flex-shrink-0">${escapeHtml((c.name || '?').charAt(0).toUpperCase())}</div>
          <div class="bg-gray-100 rounded-2xl px-3 py-1.5 flex-1">
            <div class="font-bold text-xs text-gray-800">${escapeHtml(c.name || '')}</div>
            <div class="text-gray-700">${escapeHtml(c.content)}${c.editedAt ? ' <span class="text-gray-400 italic">(đã sửa)</span>' : ''}</div>
            <div class="mt-0.5 flex gap-2 items-center">${internalCommentLikeButtonHTML(p.id, c)}${internalCommentOwnActionsHTML(p.id, c)}</div>
          </div>
        </div>`).join('')
    : `<div class="text-xs text-gray-400 italic">Chưa có bình luận nào — hãy là người đầu tiên!</div>`;
  const expandToggleHTML = comments.length > shownComments.length
    ? `<button data-op="toggleInternalCommentsExpanded" data-arg0="${p.id}" class="text-xs text-fuchsia-700 font-bold hover:underline mb-2">Xem tất cả ${comments.length} bình luận →</button>`
    : (expanded && comments.length > 5 ? `<button data-op="toggleInternalCommentsExpanded" data-arg0="${p.id}" class="text-xs text-gray-500 hover:underline mb-2">Thu gọn bình luận</button>` : '');
  const statusBadgeHTML = internalPostStatusBadgeHTML(p);
  // Duyệt/Từ chối/Yêu Cầu Bổ Sung NGAY TRÊN THẺ (Đợt E, 9/2026) — mượn nguyên khuôn banner đã có sẵn ở
  // modal Chi tiết (viewInternalPostDetail()) để người duyệt không phải mở "Chi tiết" mới xử lý được bài
  // đang chờ duyệt (trước đó Góc Chia Sẻ có Duyệt/Từ chối ngay trên thẻ nhưng Nhịp Sống HCRC thì không —
  // nay cả 2 loại cùng chung 1 khuôn, tự ẩn nếu bài không PENDING hoặc người xem không có quyền duyệt).
  const approveActionsHTML = (p.status === 'PENDING' && canApproveInternalPost(currentUser))
    ? `<div class="bg-amber-50 border border-amber-200 rounded p-3 mb-2 flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs text-amber-800">⏳ Bài đăng đang chờ phê duyệt để công khai.</span>
        <div class="flex gap-2 flex-wrap flex-shrink-0">
          <button data-op="approveInternalPostAction" data-arg0="${p.id}" class="bg-emerald-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-emerald-700">✅ Duyệt</button>
          <button data-op="rejectInternalPostAction" data-arg0="${p.id}" class="bg-red-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-red-700">❌ Từ chối</button>
          ${internalPostRequestInfoActionHTML(p)}
        </div>
      </div>`
    : '';
  const rejectReasonHTML = (p.status === 'REJECTED' && p.rejectReason)
    ? `<div class="bg-red-50 border border-red-200 rounded p-2 mb-2 text-xs text-red-800"><b>Lý do từ chối:</b> ${escapeHtml(p.rejectReason)}</div>`
    : '';
  const editHideActionsHTML = (internalPostEditButtonHTML(p) || internalPostHideActionHTML(p) || internalPostUnpinActionHTML(p) || internalPostDeleteActionHTML(p))
    ? `<div class="flex gap-2 flex-wrap mb-2">${internalPostEditButtonHTML(p)}${internalPostUnpinActionHTML(p)}${internalPostHideActionHTML(p)}${internalPostDeleteActionHTML(p)}</div>`
    : '';

  return `
    <div class="bg-white rounded border hover:shadow mb-3">
      ${coverHTML}
      <div class="p-4">
        <div class="font-bold text-fuchsia-800 text-base cursor-pointer hover:underline" data-op="viewInternalPostDetail" data-arg0="${p.id}">${escapeHtml(p.title)}${statusBadgeHTML}</div>
        <div class="text-xs text-gray-500 mt-0.5">${escapeHtml(p.authorName)} (${escapeHtml(p.dept)}) — ${escapeHtml(p.createdAt)}</div>
        ${internalPostCategoryBadgeHTML(p) ? `<div class="mt-1">${internalPostCategoryBadgeHTML(p)}</div>` : ''}
        ${approveActionsHTML}
        ${rejectReasonHTML}
        ${internalPostInfoRequestBannerHTML(p)}
        <p class="text-sm text-gray-700 mt-2">${escapeHtml(snippet)}${plain.length > 300 ? '… ' : ' '}<span class="text-fuchsia-700 font-bold cursor-pointer hover:underline" data-op="viewInternalPostDetail" data-arg0="${p.id}">Xem thêm</span></p>
        ${editHideActionsHTML}
        <div class="flex items-center justify-between border-t border-b py-1.5 my-2 text-xs text-gray-500">
          <span>❤️ ${likeCount} lượt thích</span>
          <span>💬 ${comments.length} bình luận</span>
        </div>
        <div class="flex gap-2 mb-3">
          <button data-op="toggleInternalLikeInline" data-arg0="${p.id}" class="flex-1 py-1.5 rounded font-bold text-sm ${liked ? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}">${liked ? '❤️ Đã thích' : '🤍 Thích'}</button>
          <button data-op="focusInternalCommentInput" data-arg0="${p.id}" class="flex-1 py-1.5 rounded font-bold text-sm bg-gray-100 text-gray-600 hover:bg-gray-200">💬 Bình luận</button>
        </div>
        <div class="space-y-2 mb-2">${commentsHTML}</div>
        ${expandToggleHTML}
        ${renderInternalModerationQueueHTML(p)}
        <div class="flex gap-2 items-center">
          <input id="internalCommentInput_${p.id}" type="text" placeholder="Viết bình luận..." class="flex-1 border rounded-full px-3 py-1.5 text-sm" data-op-enterkey="addInternalCommentInline" data-arg0="${p.id}">
          <button data-op="addInternalCommentInline" data-arg0="${p.id}" class="px-3 py-1.5 bg-fuchsia-600 text-white rounded-full text-xs font-bold hover:bg-fuchsia-700">Gửi</button>
        </div>
      </div>
    </div>`;
}

function toggleInternalLikeInline(id) {
  const p = DB.internalPosts.find(x => x.id === id);
  if (!p) return;
  if (!p.likes) p.likes = [];
  const idx = p.likes.indexOf(currentUser.username);
  if (idx === -1) p.likes.push(currentUser.username); else p.likes.splice(idx, 1);
  callRecordAction('internalPosts', id, 'like', {}).catch(err => console.error('Lỗi cập nhật lượt thích:', err.message));
  // Gọi dispatcher chung (không gọi thẳng renderInternalFeedStyle('NEWS')) — nút Thích này dùng chung
  // cho cả thẻ NEWS lẫn SHARE từ Đợt E, dispatcher tự redirect đúng type theo activeInternalSubTab.
  renderInternalPosts();
}

async function addInternalCommentInline(id) {
  const input = document.getElementById(`internalCommentInput_${id}`);
  const content = (input?.value || '').trim();
  if (!content) return;
  let updated;
  try {
    const result = await callRecordAction('internalPosts', id, 'comment', { content });
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const idx = DB.internalPosts.findIndex(x => x.id === id);
  if (idx !== -1) DB.internalPosts[idx] = updated;
  renderInternalPosts();
  // Bình luận vừa gửi có thể vừa bị hệ thống tự đánh dấu nghi vấn (xem
  // scanCommentForSensitiveContent() ở lib/recordActions.js) — cập nhật ngay badge/khung Phê Duyệt cho
  // người kiểm duyệt (vô hại/không đổi gì với người không có quyền, refreshApprovalSurfaces() tự chặn).
  refreshApprovalSurfaces();
}

// Người kiểm duyệt xem xét bình luận bị đánh dấu (⚠️/🚨, xem renderInternalNewsCard()) thấy KHÔNG có
// vấn đề gì — chỉ gỡ cờ, không xoá bình luận. Xoá hẳn bình luận vi phạm dùng deleteFlaggedCommentAction().
async function dismissCommentFlagAction(postId, commentId) {
  let updated;
  try {
    const result = await callRecordAction('internalPosts', postId, `comment/${commentId}/dismiss-flag`, {});
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const idx = DB.internalPosts.findIndex(x => x.id === postId);
  if (idx !== -1) DB.internalPosts[idx] = updated;
  logSystemAction('INTERNAL', 'DISMISS_COMMENT_FLAG', `Bỏ cờ cảnh báo bình luận (không vấn đề gì) ở bài [${updated.title}]`, 'SUCCESS', updated.code || '');
  renderInternalPosts();
  refreshApprovalSurfaces();
}

function deleteFlaggedCommentAction(postId, commentId) {
  if (!confirm('Xoá hẳn bình luận này? Không thể hoàn tác.')) return;
  (async () => {
    let updated;
    try {
      const result = await callRecordAction('internalPosts', postId, `comment/${commentId}/delete-comment`, {});
      updated = result.item;
    } catch (err) {
      return alert(`⛔ ${err.message}`);
    }
    const idx = DB.internalPosts.findIndex(x => x.id === postId);
    if (idx !== -1) DB.internalPosts[idx] = updated;
    logSystemAction('INTERNAL', 'DELETE_FLAGGED_COMMENT', `Xoá bình luận nhạy cảm ở bài [${updated.title}]`, 'SUCCESS', updated.code || '');
    renderInternalPosts();
    refreshApprovalSurfaces();
  })();
}

function closeInternalArticleModal() {
  document.getElementById('internalArticleModal').classList.add('hidden');
}

function viewInternalPostDetail(id) {
  const p = DB.internalPosts.find(x => x.id === id);
  if (!p) return;

  markInternalRead(id);

  const icons = { NEWS: '📰', TRAINING: '🎓', REWARD: '🏆', SHARE: '💬' };
  document.getElementById('internalArticleTitle').innerHTML = `${icons[p.type] || '📣'} ${escapeHtml(p.title)}${internalPostStatusBadgeHTML(p)}`;
  document.getElementById('internalArticleSub').innerText = `${p.authorName} (${p.dept}) — ${p.createdAt} | Mã: ${p.code}`;

  const approveActionsHTML = (p.status === 'PENDING' && canApproveInternalPost(currentUser))
    ? `<div class="bg-amber-50 border border-amber-200 rounded p-3 mb-3 flex flex-wrap items-center justify-between gap-2">
        <span class="text-xs text-amber-800">⏳ Bài đăng đang chờ phê duyệt để công khai trong Góc chia sẻ.</span>
        <div class="flex gap-2 flex-wrap flex-shrink-0">
          <button data-op="approveInternalPostAction" data-arg0="${p.id}" class="bg-emerald-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-emerald-700">✅ Duyệt</button>
          <button data-op="rejectInternalPostAction" data-arg0="${p.id}" class="bg-red-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-red-700">❌ Từ chối</button>
          ${internalPostRequestInfoActionHTML(p)}
        </div>
      </div>`
    : '';
  const rejectReasonHTML = (p.status === 'REJECTED' && p.rejectReason)
    ? `<div class="bg-red-50 border border-red-200 rounded p-3 mb-3 text-xs text-red-800"><b>Lý do từ chối:</b> ${escapeHtml(p.rejectReason)}</div>`
    : '';
  const infoRequestBannerHTML = internalPostInfoRequestBannerHTML(p);
  const editHideActionsHTML = (internalPostEditButtonHTML(p) || internalPostHideActionHTML(p) || internalPostUnpinActionHTML(p) || internalPostDeleteActionHTML(p))
    ? `<div class="flex gap-2 flex-wrap mb-3">${internalPostEditButtonHTML(p)}${internalPostUnpinActionHTML(p)}${internalPostHideActionHTML(p)}${internalPostDeleteActionHTML(p)}</div>`
    : '';

  let typeInfoHTML = '';
  if (p.type === 'TRAINING' && p.training) {
    const t = p.training;
    const regCount = (t.registeredUsers || []).length;
    // Khớp đúng kiểm tra hạn đăng ký ở server (registerInternalPostTraining(), lib/recordActions.js —
    // so chuỗi ISO ngày YYYY-MM-DD, không dùng nowVN()) — trước đây nút ở đây CHỈ tính đủ số lượng
    // (isFull theo capacity), không hề xét registerDeadline: quá hạn đăng ký nhưng chưa đủ số lượng thì
    // nút vẫn hiện "✅ Đăng Ký Tham Gia" có thể bấm được, bấm vào chỉ nhận lỗi 409 từ server thay vì
    // được ẩn/disable đúng ngay từ đầu.
    const isPastDeadline = !!(t.registerDeadline && new Date().toISOString().slice(0, 10) > t.registerDeadline);
    const isFull = t.capacity > 0 && regCount >= t.capacity;
    const isRegistered = (t.registeredUsers || []).includes(currentUser.username);
    const blocked = isFull || isPastDeadline;
    const blockedLabel = isPastDeadline ? 'Đã Hết Hạn Đăng Ký' : 'Đã Đủ Số Lượng';
    typeInfoHTML = `
      <div class="bg-emerald-50 border border-emerald-200 rounded p-3 mb-3 text-sm space-y-1">
        <div><b>Thời gian:</b> ${escapeHtml(t.startTime || '')}${t.endTime ? ` ➔ ${escapeHtml(t.endTime)}` : ''}</div>
        <div><b>Địa điểm:</b> ${escapeHtml(t.location || 'N/A')}</div>
        ${t.registerDeadline ? `<div><b>Hạn đăng ký:</b> ${escapeHtml(t.registerDeadline)}</div>` : ''}
        <div><b>Số lượng đăng ký:</b> ${regCount}${t.capacity ? '/' + t.capacity : ' (không giới hạn)'}</div>
        <div class="pt-1">
          ${isRegistered
            ? `<button data-op="unregisterFromTraining" data-arg0="${p.id}" class="bg-gray-500 text-white px-3 py-1 rounded text-xs font-bold hover:bg-gray-600">Hủy Đăng Ký</button>`
            : `<button data-op="registerForTraining" data-arg0="${p.id}" ${blocked ? 'disabled' : ''} class="${blocked ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-emerald-600 text-white hover:bg-emerald-700'} px-3 py-1 rounded text-xs font-bold">${blocked ? blockedLabel : '✅ Đăng Ký Tham Gia'}</button>`}
        </div>
      </div>
    `;
  }
  if (p.type === 'REWARD' && p.reward) {
    typeInfoHTML = `
      <div class="bg-amber-50 border border-amber-200 rounded p-3 mb-3 text-sm space-y-1">
        <div><b>Đợt/Kỳ:</b> ${escapeHtml(p.reward.period || 'N/A')}</div>
        <div><b>Được khen thưởng:</b> ${escapeHtml(p.reward.recipients || '')}</div>
      </div>
    `;
  }

  const isLiked = (p.likes || []).includes(currentUser.username);
  const allComments = (p.comments || []).filter(c => !c.pendingModeration);
  const expandedDetail = expandedInternalComments.has(p.id);
  const shownComments = expandedDetail ? allComments : pickHighlightedComments(allComments);
  const commentsHTML = shownComments.length
    ? shownComments.map(c => `
        <div class="bg-gray-50 border rounded p-2 text-xs">
          <div class="font-bold text-gray-700">${escapeHtml(c.name)} <span class="text-gray-400 font-normal">${escapeHtml(c.time)}</span></div>
          <div class="text-gray-800 mt-0.5">${escapeHtml(c.content)}${c.editedAt ? ' <span class="text-gray-400 italic">(đã sửa)</span>' : ''}</div>
          <div class="mt-1 flex gap-2 items-center">${internalCommentLikeButtonHTML(p.id, c)}${internalCommentOwnActionsHTML(p.id, c)}</div>
        </div>
      `).join('')
    : '<div class="text-gray-400 italic text-xs">Chưa có bình luận nào.</div>';
  const expandToggleDetailHTML = allComments.length > shownComments.length
    ? `<button data-op="toggleInternalCommentsExpandedAndView" data-arg0="${p.id}" class="text-xs text-fuchsia-700 font-bold hover:underline">Xem tất cả ${allComments.length} bình luận →</button>`
    : (expandedDetail && allComments.length > 5 ? `<button data-op="toggleInternalCommentsExpandedAndView" data-arg0="${p.id}" class="text-xs text-gray-500 hover:underline">Thu gọn bình luận</button>` : '');

  const isImg = isInternalImageAttachment(p.attachment);
  // Bài MỚI có images[] -> thư viện ảnh (ảnh lớn + dải thumbnail + nút ‹ ›, buildInternalGalleryHTML());
  // bài CŨ (không có images[]) giữ NGUYÊN 1 ảnh bìa từ attachment như trước. Video (nếu có) hiện ngay dưới.
  const hasGallery = Array.isArray(p.images) && p.images.length > 0;
  const coverHTML = hasGallery
    ? buildInternalGalleryHTML(p)
    : (isImg ? `<img src="${escapeHtml(p.attachment.fileUrl)}" alt="" class="w-full max-h-96 object-cover">` : '');
  const videosHTML = buildInternalVideosHTML(p);
  // Đi qua attachmentDownloadUrl() (route /api/files/download) như mọi module khác — trước đây trỏ
  // thẳng p.attachment.fileUrl (route tĩnh /uploads/), bỏ qua bước đóng dấu watermark PDF mà mọi luồng
  // tải PDF khác trong hệ thống đều có (routes/download.js CHO PHÉP tải khi không tìm thấy bản ghi sở
  // hữu trong 5 collection đã biết — đúng thiết kế "internal posts mở cho mọi người xem", vẫn đóng dấu
  // watermark nếu là PDF).
  const attachmentLinkHTML = (p.attachment && !isImg)
    ? `<div class="mt-3"><a href="${escapeHtml(attachmentDownloadUrl(p.attachment.fileUrl, p.attachment.fileData, p.attachment.fileName))}" target="_blank" class="text-blue-600 underline text-xs">📎 ${escapeHtml(p.attachment.fileName)}</a></div>`
    : '';

  document.getElementById('internalArticleContent').innerHTML = `
    ${coverHTML}
    <div class="w-full p-6 text-sm">
      ${approveActionsHTML}
      ${rejectReasonHTML}
      ${infoRequestBannerHTML}
      ${editHideActionsHTML}
      ${typeInfoHTML}
      ${internalPostCategoryBadgeHTML(p) ? `<div class="mb-2">${internalPostCategoryBadgeHTML(p)}</div>` : ''}
      ${internalPostBodyHTML(p)}
      ${videosHTML}
      ${attachmentLinkHTML}

      <div class="border-t mt-4 pt-3 flex items-center gap-3">
        <button data-op="toggleInternalLike" data-arg0="${p.id}" class="px-3 py-1 rounded text-xs font-bold ${isLiked ? 'bg-rose-600 text-white' : 'bg-gray-200 text-gray-700'}">❤️ ${isLiked ? 'Đã thích' : 'Thích'} (${(p.likes || []).length})</button>
        <span class="text-xs text-gray-500">👁️ ${(p.readBy || []).length} người đã xem</span>
      </div>

      <div class="border-t mt-3 pt-3 space-y-2">
        <b class="text-xs">💬 Bình luận (${allComments.length})</b>
        <div class="space-y-1.5 max-h-48 overflow-y-auto">${commentsHTML}</div>
        ${expandToggleDetailHTML}
        ${renderInternalModerationQueueHTML(p)}
        <div class="flex gap-2 pt-1">
          <input id="internalCommentInput" placeholder="Viết bình luận..." class="flex-1 border p-1.5 rounded text-xs" data-op-enterkey="addInternalComment" data-arg0="${p.id}">
          <button data-op="addInternalComment" data-arg0="${p.id}" class="bg-fuchsia-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-fuchsia-700">Gửi</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('internalArticleModal').classList.remove('hidden');
  // Nội dung HTML (bài mới) gán SAU khi lọc DOMPurify — bất đồng bộ (nạp lười thư viện lần đầu).
  hydrateInternalRichBody(document.getElementById('internalArticleContent'), p);
}

// ---- Thư viện ảnh ở modal Chi tiết (thuần JS/CSS, không thư viện ngoài) ----
// Thứ tự: ảnh đại diện (coverImage) đứng ĐẦU, các ảnh còn lại theo thứ tự đã đăng.
function getInternalGalleryImages(p) {
  const imgs = (Array.isArray(p?.images) ? p.images : []).filter(x => x && x.fileUrl);
  const coverUrl = p?.coverImage?.fileUrl;
  const cover = imgs.find(x => x.fileUrl === coverUrl);
  return cover ? [cover, ...imgs.filter(x => x !== cover)] : imgs;
}

function buildInternalGalleryHTML(p) {
  const imgs = getInternalGalleryImages(p);
  if (!imgs.length) return '';
  const pid = Number(p.id);
  const navHTML = imgs.length > 1
    ? `<button type="button" data-op="stepInternalGallery" data-arg0="${pid}" data-arg1="-1" aria-label="Ảnh trước" class="internal-gallery-prev absolute left-2 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white w-8 h-8 rounded-full font-bold hover:bg-opacity-70">‹</button>
       <button type="button" data-op="stepInternalGallery" data-arg0="${pid}" data-arg1="1" aria-label="Ảnh sau" class="internal-gallery-next absolute right-2 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white w-8 h-8 rounded-full font-bold hover:bg-opacity-70">›</button>
       <span class="internal-gallery-counter absolute bottom-2 right-2 bg-black bg-opacity-60 text-white text-[11px] font-bold px-2 py-0.5 rounded">1/${imgs.length}</span>`
    : '';
  const thumbsHTML = imgs.length > 1
    ? `<div class="internal-gallery-thumbs flex gap-1.5 overflow-x-auto p-2 bg-gray-50 border-b">${imgs.map((img, idx) => `
        <img src="${escapeHtml(img.fileUrl)}" alt="${escapeHtml(img.fileName || '')}" data-op="showInternalGalleryImage" data-arg0="${pid}" data-arg1="${idx}" data-gallery-idx="${idx}" class="internal-gallery-thumb w-16 h-16 object-cover rounded cursor-pointer flex-shrink-0 border-2 ${idx === 0 ? 'border-fuchsia-600' : 'border-transparent'}">`).join('')}
      </div>`
    : '';
  return `
    <div class="internal-gallery" data-gallery-post="${pid}" data-gallery-idx="0">
      <div class="relative bg-gray-100">
        <img src="${escapeHtml(imgs[0].fileUrl)}" alt="${escapeHtml(imgs[0].fileName || '')}" class="internal-gallery-main w-full h-72 md:h-96 object-contain">
        ${navHTML}
      </div>
      ${thumbsHTML}
    </div>`;
}

function showInternalGalleryImage(postId, idx) {
  const p = DB.internalPosts.find(x => x.id === Number(postId));
  const imgs = getInternalGalleryImages(p);
  if (!imgs.length) return;
  const i = ((Number(idx) % imgs.length) + imgs.length) % imgs.length;
  const root = document.querySelector(`#internalArticleContent .internal-gallery[data-gallery-post="${Number(postId)}"]`);
  if (!root) return;
  root.dataset.galleryIdx = String(i);
  const main = root.querySelector('.internal-gallery-main');
  if (main) { main.src = imgs[i].fileUrl; main.alt = imgs[i].fileName || ''; }
  const counter = root.querySelector('.internal-gallery-counter');
  if (counter) counter.textContent = `${i + 1}/${imgs.length}`;
  root.querySelectorAll('.internal-gallery-thumb').forEach(t => {
    const active = Number(t.dataset.galleryIdx) === i;
    t.classList.toggle('border-fuchsia-600', active);
    t.classList.toggle('border-transparent', !active);
  });
}

function stepInternalGallery(postId, delta) {
  const root = document.querySelector(`#internalArticleContent .internal-gallery[data-gallery-post="${Number(postId)}"]`);
  if (!root) return;
  showInternalGalleryImage(postId, Number(root.dataset.galleryIdx || 0) + Number(delta));
}

// Nhánh theo loại: 'youtube' (type tường minh) -> <iframe> nhúng www.youtube.com/embed/<videoId> (frameSrc
// CSP đã mở sẵn cho https://www.youtube.com, xem lib/securityHeaders.js); còn lại (kể cả bài CŨ không có
// type) -> <video> tệp tải lên như trước. referrerpolicy tường minh vì helmet mặc định gửi
// Referrer-Policy: no-referrer cho cả trang, mà trình phát YouTube nhúng từ chối phát khi không có referrer.
// Link YouTube không tách được videoId (hiếm, VD link kênh) -> chỉ hiện liên kết mở tab mới, và CHỈ khi link
// đúng https + tên miền YouTube (không bao giờ đưa scheme lạ vào href).
function buildInternalVideosHTML(p) {
  const vids = (Array.isArray(p?.videos) ? p.videos : []).filter(x => x && (isInternalYoutubeVideo(x) ? x.youtubeUrl : x.fileUrl));
  if (!vids.length) return '';
  return `<div class="internal-videos mt-3 space-y-2">${vids.map(v => {
    if (isInternalYoutubeVideo(v)) {
      const embed = internalYoutubeEmbedUrl(v.youtubeUrl);
      if (embed) {
        return `
    <div class="internal-video-youtube">
      <iframe src="${escapeHtml(embed)}" title="Video YouTube" class="w-full h-72 md:h-96 bg-black rounded border-0" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
      <div class="text-[11px] text-gray-500 mt-0.5">▶️ YouTube</div>
    </div>`;
      }
      let safeLink = false;
      try { const u = new URL(String(v.youtubeUrl)); safeLink = u.protocol === 'https:' && INTERNAL_YOUTUBE_HOSTNAMES_CLIENT.includes(u.hostname.toLowerCase()); } catch (e) { safeLink = false; }
      return safeLink
        ? `<div class="internal-video-youtube text-sm">▶️ <a href="${escapeHtml(v.youtubeUrl)}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline">Xem video trên YouTube</a></div>`
        : '';
    }
    return `
    <div>
      <video controls preload="metadata" src="${escapeHtml(v.fileUrl)}" class="w-full max-h-96 bg-black rounded"></video>
      <div class="text-[11px] text-gray-500 mt-0.5">🎬 ${escapeHtml(v.fileName || '')}</div>
    </div>`;
  }).join('')}</div>`;
}

// 5 hành động tương tác dưới đây (đánh dấu đã đọc/thích/bình luận/đăng ký đào tạo) đi qua
// /api/records/internalPosts/:id/<action> (server tự xác thực + gán danh tính từ phiên đăng nhập,
// không tin giá trị client gửi — xem lib/recordActions.js). Đánh dấu đã đọc/thích vẫn cập nhật CỤC BỘ
// ngay lập tức trước khi gọi API (không đợi phản hồi) để UI phản hồi tức thì như trước đây (số người
// xem/trạng thái nút thích), server vẫn là nguồn xác nhận thật cho lần tải lại dữ liệu sau.
function markInternalRead(id) {
  const p = DB.internalPosts.find(x => x.id === id);
  if (!p) return;
  if (!p.readBy) p.readBy = [];
  if (p.readBy.includes(currentUser.username)) return;
  p.readBy.push(currentUser.username);
  callRecordAction('internalPosts', id, 'mark-read', {}).catch(err => console.error('Lỗi đánh dấu đã đọc:', err.message));
}

function toggleInternalLike(id) {
  const p = DB.internalPosts.find(x => x.id === id);
  if (!p) return;
  if (!p.likes) p.likes = [];
  const idx = p.likes.indexOf(currentUser.username);
  if (idx === -1) p.likes.push(currentUser.username);
  else p.likes.splice(idx, 1);
  callRecordAction('internalPosts', id, 'like', {}).catch(err => console.error('Lỗi cập nhật lượt thích:', err.message));
  viewInternalPostDetail(id);
  renderInternalPosts();
}

async function addInternalComment(id) {
  const input = document.getElementById('internalCommentInput');
  const content = input.value.trim();
  if (!content) return;
  let updated;
  try {
    const result = await callRecordAction('internalPosts', id, 'comment', { content });
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const idx = DB.internalPosts.findIndex(x => x.id === id);
  if (idx !== -1) DB.internalPosts[idx] = updated;
  viewInternalPostDetail(id);
  renderInternalPosts();
}

async function registerForTraining(id) {
  const p = DB.internalPosts.find(x => x.id === id);
  if (!p || !p.training) return;
  if ((p.training.registeredUsers || []).includes(currentUser.username)) return;
  let updated;
  try {
    const result = await callRecordAction('internalPosts', id, 'register-training', {});
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const idx = DB.internalPosts.findIndex(x => x.id === id);
  if (idx !== -1) DB.internalPosts[idx] = updated;
  logSystemAction('INTERNAL', 'REGISTER_TRAINING', `Đăng ký tham gia đào tạo [${p.code} - ${p.title}]`, 'SUCCESS', p.code);
  alert('✅ Đã đăng ký tham gia thành công!');
  viewInternalPostDetail(id);
  renderInternalPosts();
}

async function unregisterFromTraining(id) {
  const p = DB.internalPosts.find(x => x.id === id);
  if (!p || !p.training) return;
  let updated;
  try {
    const result = await callRecordAction('internalPosts', id, 'unregister-training', {});
    updated = result.item;
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  const idx = DB.internalPosts.findIndex(x => x.id === id);
  if (idx !== -1) DB.internalPosts[idx] = updated;
  viewInternalPostDetail(id);
  renderInternalPosts();
}

// Duyệt/Từ chối bài "Góc chia sẻ" (status PENDING) — qua modal xác nhận Đồng Ý/Hủy dùng chung
// (showConfirmModal(), khớp pattern Văn bản trình/Đăng ký xe/Đề xuất văn phòng), server tự xác thực lại
// quyền internalPostApprove/admin (xem lib/recordActions.js) nên không tin riêng việc ẩn/hiện nút này.
function approveInternalPostAction(id) {
  const p = DB.internalPosts.find(x => x.id === id);
  if (!p) return;
  showConfirmModal({
    title: 'Phê duyệt bài đăng',
    bodyHTML: `Bạn có chắc chắn muốn phê duyệt bài "<b>${escapeHtml(p.title)}</b>" để công khai trong Góc chia sẻ?`,
    confirmLabel: 'Phê Duyệt',
    onConfirm: async () => {
      let updated;
      try {
        const result = await callRecordAction('internalPosts', id, 'approve', {});
        updated = result.item;
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const idx = DB.internalPosts.findIndex(x => x.id === id);
      if (idx !== -1) DB.internalPosts[idx] = updated;
      logSystemAction('INTERNAL', 'APPROVE_INTERNAL_POST', `Phê duyệt bài Góc chia sẻ [${updated.code} - ${updated.title}]`, 'SUCCESS', updated.code);
      notifyUsersByEmail('INTERNAL', 'NOTIFY_APPROVED', updated.code, [updated.author],
        `[VPDT] Bài đăng "${updated.title}" đã được phê duyệt`,
        `Bài đăng Góc chia sẻ "${updated.title}" (${updated.code}) của bạn đã được phê duyệt và hiển thị công khai.`);
      closeInternalArticleModal();
      renderInternalPosts();
      refreshApprovalSurfaces();
    }
  });
}

function rejectInternalPostAction(id) {
  const p = DB.internalPosts.find(x => x.id === id);
  if (!p) return;
  const reason = prompt('Nhập lý do từ chối bài đăng:');
  if (reason === null) return;
  if (!reason.trim()) return alert('⛔ Vui lòng nhập lý do từ chối!');
  showConfirmModal({
    title: 'Từ chối bài đăng',
    bodyHTML: `Bạn có chắc chắn muốn từ chối bài "<b>${escapeHtml(p.title)}</b>"?<br><span class="text-xs text-gray-500">Lý do: ${escapeHtml(reason.trim())}</span>`,
    confirmLabel: 'Từ Chối',
    onConfirm: async () => {
      let updated;
      try {
        const result = await callRecordAction('internalPosts', id, 'reject', { reason: reason.trim() });
        updated = result.item;
      } catch (err) {
        return alert(`⛔ ${err.message}`);
      }
      const idx = DB.internalPosts.findIndex(x => x.id === id);
      if (idx !== -1) DB.internalPosts[idx] = updated;
      logSystemAction('INTERNAL', 'REJECT_INTERNAL_POST', `Từ chối bài Góc chia sẻ [${updated.code} - ${updated.title}] - Lý do: ${reason.trim()}`, 'WARNING', updated.code);
      notifyUsersByEmail('INTERNAL', 'NOTIFY_REJECTED', updated.code, [updated.author],
        `[VPDT] Bài đăng "${updated.title}" đã bị từ chối`,
        `Bài đăng Góc chia sẻ "${updated.title}" (${updated.code}) của bạn đã bị từ chối.\nLý do: ${reason.trim()}`);
      closeInternalArticleModal();
      renderInternalPosts();
      refreshApprovalSurfaces();
    }
  });
}

