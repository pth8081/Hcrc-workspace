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
  activeInternalSubTab = subTab;

  // Đổi tab con luôn thoát chế độ Sửa (nếu có) — form trắng, quay lại chế độ Đăng bài mới. Cùng khuôn
  // cancelEditCustomField() ở Biểu Mẫu (đổi tab = huỷ dở dang thao tác Sửa đang mở).
  editingInternalPostId = null;
  document.getElementById('internalCancelEditBtn')?.classList.add('hidden');

  const btnMap = { NEWS: 'btnInternalSubNews', TRAINING: 'btnInternalSubTraining', RECRUITMENT: 'btnInternalSubRecruitment', SHARE: 'btnInternalSubShare', QNA: 'btnInternalSubQna' };
  Object.entries(btnMap).forEach(([type, btnId]) => {
    const btn = document.getElementById(btnId);
    if (btn) btn.className = type === subTab ? 'px-3 py-1 rounded text-xs font-bold bg-fuchsia-700 text-white' : 'px-3 py-1 rounded text-xs font-bold bg-gray-200 text-gray-700';
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
    renderHrFeedbackInbox();
    return;
  }

  // Ghim lên trang chủ (Đợt E) — không áp dụng Góc chia sẻ (còn phải qua duyệt mới công khai), chỉ
  // người có quyền internalPostApprove/admin mới thấy. Đặt lại checkbox mỗi lần đổi tab để không vô
  // tình mang theo lựa chọn ghim của loại bài trước đó.
  document.getElementById('internalPinField').classList.toggle('hidden', subTab === 'SHARE' || !canApproveInternalPost(currentUser));
  document.getElementById('internalPinCheckbox').checked = false;
  document.getElementById('internalPinDurationWrap').classList.add('hidden');

  // Chuyên đề (NEWS/SHARE, xem CORE_FIELD_MANIFEST.INTERNAL_POST) + Lịch đăng (chỉ NEWS) — chỉ 2 tab
  // này còn dùng #internalPostForm (Đào tạo/Tuyển dụng đã return sớm ở trên với form riêng).
  document.getElementById('internalCategoryNewsField').classList.toggle('hidden', subTab !== 'NEWS');
  document.getElementById('internalCategoryShareField').classList.toggle('hidden', subTab !== 'SHARE');
  document.getElementById('internalPublishAtField').classList.toggle('hidden', subTab !== 'NEWS');
  populateInternalPostCategorySelects();
  renderDynamicInputsForModule('INTERNAL_POST', 'dynamicFieldsContainer_INTERNAL_POST');

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

async function submitInternalPost(e) {
  e.preventDefault();
  const type = activeInternalSubTab;
  const isEditing = !!editingInternalPostId;
  // 2 nút submit CÙNG form ("Lưu Nháp"/"Đăng Ngay-Gửi Duyệt") — phân biệt bằng nút NÀO thực sự kích
  // hoạt submit (event.submitter, chuẩn HTML form), không phải trạng thái ngoài form nào khác.
  const isDraftSubmit = e.submitter?.id === 'internalDraftBtn';

  if (!isEditing && !canCreateInternalPost(currentUser, type)) {
    return alert('⛔ Bạn không có quyền đăng bài ở phân hệ này!');
  }

  const title = document.getElementById('internalTitle').value.trim();
  const content = document.getElementById('internalContent').value.trim();

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

  // Chuyên đề (NEWS/SHARE, xem CORE_FIELD_MANIFEST.INTERNAL_POST) — 2 <select> riêng theo type, server
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
    try {
      const uploaded = await uploadFileToServer(fileInput.files[0], 'internal');
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

  // Trường bổ sung (Biểu Mẫu > Truyền Thông Nội Bộ - Chuyên Đề) — chỉ NEWS/SHARE còn hiện
  // #dynamicFieldsContainer_INTERNAL_POST (TRAINING/RECRUITMENT return sớm ở trên với form riêng).
  let customData;
  try {
    customData = await collectDynamicFieldsData('INTERNAL_POST');
  } catch (err) {
    return alert(`⛔ ${err.message}`);
  }
  // Sửa bài: gộp với customData cũ của bài (thay vì ghi đè toàn bộ) — cùng lý do với attachment ở
  // trên, tránh mất giá trị trường kiểu Tải tệp không được chọn lại (collectDynamicFieldsData() bỏ
  // hẳn field đó khỏi kết quả khi không có tệp mới, xem hàm này ở phần Biểu Mẫu).
  if (isEditing) {
    const existingPost = DB.internalPosts.find(x => x.id === editingInternalPostId);
    customData = { ...(existingPost?.customData || {}), ...customData };
  }

  if (isEditing) {
    const payload = { title, content, draft: isDraftSubmit, customData };
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
    cancelEditInternalPost();
    if (updated.status === 'DRAFT') alert('✅ Đã lưu nháp!');
    else if (updated.status === 'PENDING') alert('✅ Đã gửi lại, bài viết sẽ hiển thị công khai sau khi được phê duyệt!');
    else alert('✅ Đã cập nhật và đăng bài thành công!');
    renderInternalPosts();
    return;
  }

  const postPayload = {
    type,
    code: `${INTERNAL_TYPE_PREFIX[type]}-${Date.now()}`,
    title, content,
    attachment,
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
  e.target.reset();
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
  document.getElementById('internalContent').value = p.content || '';
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
  document.getElementById('internalCancelEditBtn').classList.add('hidden');
  setInternalSubTab(activeInternalSubTab); // khôi phục tiêu đề/nhãn nút mặc định của tab hiện tại
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
  if (!canManage && activeRecruitmentTab === 'MANAGE') { activeRecruitmentTab = 'JOBS'; }
  // Đồng bộ class active/hidden của cả 3 nút tab con — "Quản Lý Ứng Viên" chỉ HR mới thấy nút.
  const btnMap = { JOBS: 'btnRecruitmentJobs', MY_REFERRALS: 'btnRecruitmentMyReferrals', MANAGE: 'btnRecruitmentManage' };
  Object.entries(btnMap).forEach(([key, btnId]) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    const active = key === activeRecruitmentTab;
    const isManage = key === 'MANAGE';
    btn.className = (active ? 'px-3 py-1 rounded text-xs font-bold bg-amber-700 text-white' : 'px-3 py-1 rounded text-xs font-bold bg-gray-200 text-gray-700') + (isManage && !canManage ? ' hidden' : '');
  });
  document.getElementById('recruitmentJobsPanel').classList.toggle('hidden', activeRecruitmentTab !== 'JOBS');
  document.getElementById('recruitmentMyReferralsPanel').classList.toggle('hidden', activeRecruitmentTab !== 'MY_REFERRALS');
  document.getElementById('recruitmentManagePanel').classList.toggle('hidden', activeRecruitmentTab !== 'MANAGE');

  if (activeRecruitmentTab === 'JOBS') renderRecruitmentJobs();
  else if (activeRecruitmentTab === 'MY_REFERRALS') renderRecruitmentMyReferrals();
  else if (activeRecruitmentTab === 'MANAGE') renderRecruitmentManage();
}

async function submitRecruitmentJob(e) {
  e.preventDefault();
  if (!canManageRecruitmentLocal(currentUser)) return alert('⛔ Bạn không có quyền đăng tin tuyển dụng!');
  // Banner (tuỳ chọn) — đi qua đúng uploadFileToServer('internal') như CV giới thiệu ứng viên ở
  // submitRecruitmentReferral() bên dưới, KHÔNG dựng đường upload riêng.
  const bannerFile = document.getElementById('rjBannerFile').files[0];
  let bannerUrl = '', bannerFileName = '';
  if (bannerFile) {
    try {
      const uploadedBanner = await uploadFileToServer(bannerFile, 'internal');
      bannerUrl = uploadedBanner.fileUrl;
      bannerFileName = uploadedBanner.fileName;
    } catch (err) {
      return alert(`⛔ Tải banner thất bại: ${err.message}`);
    }
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
    bannerUrl, bannerFileName
  };
  let newJob;
  try {
    const result = await callCreateAction('recruitmentJobs', payload);
    newJob = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  DB.recruitmentJobs.unshift(newJob);
  logSystemAction('INTERNAL', 'CREATE_RECRUITMENT_JOB', `Đăng tin tuyển dụng [${newJob.title}]`, 'SUCCESS');
  alert('✅ Đã đăng tin tuyển dụng thành công!');
  e.target.reset();
  resetListPage('recruitmentJobs');
  renderRecruitmentJobs();
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

function onRecruitmentJobsFilterChange() {
  resetListPage('recruitmentJobs');
  renderRecruitmentJobs();
}

function renderRecruitmentJobs() {
  const container = document.getElementById('recruitmentJobsContainer');
  populateRecruitmentJobsMonthFilter();
  const filterMonth = document.getElementById('rjFilterMonth')?.value || '';
  const filterDept = document.getElementById('rjFilterDept')?.value || '';
  const filterKeyword = (document.getElementById('rjFilterKeyword')?.value || '').trim();
  let list = (DB.recruitmentJobs || []).slice().sort((a, b) => b.id - a.id).filter(j => {
    if (filterMonth && j.month !== filterMonth) return false;
    if (filterDept && j.hiringDept !== filterDept) return false;
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
    const bannerHTML = j.bannerUrl ? `<img src="${escapeHtml(j.bannerUrl)}" alt="" class="w-full h-32 object-cover rounded">` : '';
    // Gợi ý "Đã tuyển đủ" khi referral HIRED đạt slots — CHỈ là banner gợi ý, nút xác nhận vẫn LUÔN bấm
    // được bất kể số này (HR có thể đã tuyển qua kênh ngoài hệ thống này không thấy được — đã chốt với
    // người yêu cầu tính năng, xem confirmRecruitmentJobFilled() ở lib/recordActions.js).
    const suggestFilledHTML = (canManage && isOpen && j.slots > 0 && hiredCount >= j.slots)
      ? `<p class="text-[11px] text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-1">💡 Đã có ${hiredCount}/${j.slots} referral được tuyển — xác nhận đã tuyển đủ?</p>`
      : '';
    return `
      <div class="bg-white border rounded p-3 space-y-1.5">
        ${bannerHTML}
        <div class="flex justify-between items-start gap-2">
          <h4 class="font-bold text-gray-800 text-sm">${escapeHtml(j.title)}</h4>
          ${statusBadge}
        </div>
        <p class="text-xs text-gray-500">${j.hiringDept ? '🏢 ' + escapeHtml(j.hiringDept) + ' · ' : ''}${j.location ? '📍 ' + escapeHtml(j.location) + ' · ' : ''}${j.slots > 0 ? 'Cần ' + j.slots + ' người' : 'Không giới hạn số lượng'}${j.deadline ? ' · Hạn: ' + escapeHtml(j.deadline) : ''}${j.month ? ' · Đợt: ' + escapeHtml(j.month) : ''}</p>
        <p class="text-xs text-gray-700 whitespace-pre-wrap">${escapeHtml(j.description)}</p>
        ${j.requirements ? `<p class="text-xs text-gray-500"><span class="font-semibold">Yêu cầu:</span> ${escapeHtml(j.requirements)}</p>` : ''}
        ${j.contactInfo ? `<p class="text-xs text-gray-600"><span class="font-semibold">Liên hệ:</span> ${escapeHtml(j.contactInfo)}</p>` : ''}
        <p class="text-[11px] text-gray-400">Đăng bởi ${escapeHtml(j.creatorName || j.creator)} · ${referralCount} lượt giới thiệu</p>
        ${suggestFilledHTML}
        <div class="flex gap-2 pt-1 flex-wrap">
          ${isOpen ? `<button data-op="openRecruitmentReferModal" data-arg0="${j.id}" class="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded text-xs font-bold">🙋 Giới Thiệu Ứng Viên</button>` : ''}
          ${canManage && isOpen ? `<button data-op="confirmRecruitmentJobFilledUi" data-arg0="${j.id}" class="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1 rounded text-xs font-bold">✅ Xác Nhận Đã Tuyển Đủ</button>` : ''}
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
  document.getElementById('recruitmentReferForm').reset();
  document.getElementById('rrJobId').value = jobId;
  document.getElementById('rrJobTitleLabel').innerText = job.title;
  document.getElementById('rrReferrerLabel').innerText = currentUser.name;
  document.getElementById('recruitmentReferModal').classList.remove('hidden');
}

function closeRecruitmentReferModal() {
  document.getElementById('recruitmentReferModal').classList.add('hidden');
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
  const payload = {
    jobId,
    candidateName: document.getElementById('rrCandidateName').value.trim(),
    candidatePhone: document.getElementById('rrCandidatePhone').value.trim(),
    candidateEmail: document.getElementById('rrCandidateEmail').value.trim(),
    candidateNote: document.getElementById('rrCandidateNote').value.trim(),
    cvFileUrl: uploaded.fileUrl,
    cvFileName: uploaded.fileName
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

// Ảnh đính kèm (theo mimetype trả về từ /api/upload) được hiển thị trực tiếp kiểu trang báo —
// không cần mở qua Frame Protected Viewer như tài liệu/hợp đồng, vì nội dung Truyền thông không
// phải hồ sơ mật. Tệp đính kèm không phải ảnh (PDF...) vẫn hiện link tải bình thường.
function isInternalImageAttachment(att) {
  return !!(att && typeof att.fileType === 'string' && att.fileType.startsWith('image/'));
}

// "Tin tức" (NEWS) dùng khung hiển thị kiểu Facebook riêng (renderInternalNewsFeed) — bình luận/thích
// ngay dưới bài, không cần mở "Chi tiết". 3 loại còn lại (Đào tạo/Khen thưởng/Góc chia sẻ) giữ nguyên
// khung danh sách + phân trang cũ bên dưới.
let internalNewsSortMode = 'recent'; // 'recent' | 'popular'
function setInternalNewsSort(mode) {
  internalNewsSortMode = mode;
  resetListPage('internalNews');
  renderInternalPosts();
}

// ===================== Trạng thái đặc biệt (Đợt 1 Nhịp Sống HCRC/Góc Chia Sẻ) =====================
// Pill trạng thái dùng CHUNG cho danh sách thường (renderInternalPosts — Đào tạo/Khen thưởng/Góc chia
// sẻ), khung Nhịp Sống HCRC kiểu Facebook (renderInternalNewsFeed/Card) và modal Chi tiết
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
  if (activeInternalSubTab === 'NEWS') return renderInternalNewsFeed();
  const container = document.getElementById('internalPostsContainer');
  if (!container) return;
  // Khối phân trang riêng của Nhịp Sống HCRC ('internalNews') không dùng ở đây — dọn sạch nếu còn sót
  // lại từ lúc đang ở tab NEWS.
  const newsPaginationEl = document.getElementById('paginationContainer_internalNews');
  if (newsPaginationEl) newsPaginationEl.innerHTML = '';

  const fromDate = document.getElementById('filterFromDateInternal')?.value || '';
  const toDate = document.getElementById('filterToDateInternal')?.value || '';
  const keyword = (document.getElementById('filterKeywordInternal')?.value || '').trim();

  // Chỉ loại bài "Góc Chia Sẻ" (SHARE) mới thực sự đi qua quy trình PENDING/APPROVED/REJECTED (xem
  // canApproveInternalPost() ở lib/recordActions.js) — các loại khác (TRAINING/REWARD) luôn đã APPROVED
  // ngay khi đăng, nên chỉ hiện ô lọc trạng thái + dashboard khi đang ở tab SHARE.
  const isShareTab = activeInternalSubTab === 'SHARE';
  const statusFilterWrap = document.getElementById('internalStatusFilterWrap');
  if (statusFilterWrap) statusFilterWrap.classList.toggle('hidden', !isShareTab);
  const statusFilter = isShareTab ? (document.getElementById('filterStatusInternal')?.value || '') : '';

  const canApprove = canApproveInternalPost(currentUser);
  const dashEl = document.getElementById('internalDashboardCards');
  if (isShareTab) {
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
    if (!matchesKeywordFields([p.title, p.content, p.authorName, p.dept], keyword)) return false;
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
    const snippet = (p.content || '').slice(0, 200);
    const coverThumbHTML = isInternalImageAttachment(p.attachment)
      ? `<img src="${escapeHtml(p.attachment.fileUrl)}" alt="" class="w-full sm:w-48 h-40 sm:h-auto object-cover cursor-pointer flex-shrink-0" data-op="viewInternalPostDetail" data-arg0="${p.id}">`
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
          <div class="font-bold text-fuchsia-800 text-base cursor-pointer hover:underline" data-op="viewInternalPostDetail" data-arg0="${p.id}">${escapeHtml(p.title)}${statusBadgeHTML}${pinBadgeHTML}</div>
          <div class="text-xs text-gray-500 mt-0.5">${escapeHtml(p.authorName)} (${escapeHtml(p.dept)}) — ${escapeHtml(p.createdAt)}</div>
          ${internalPostInfoRequestBannerHTML(p)}
          <p class="text-sm text-gray-700 mt-2 flex-1">${escapeHtml(snippet)}${(p.content || '').length > 200 ? '…' : ''}</p>
          ${extraInfo}
          <div class="flex flex-wrap justify-between items-center gap-2 mt-3">
            <div class="flex gap-4 text-xs text-gray-500">
              <span>❤️ ${likeCount}</span>
              <span>💬 ${commentCount}</span>
              <span>👁️ ${readCount} đã xem</span>
            </div>
            <div class="flex gap-2 flex-wrap">
              ${approveActionsHTML}
              ${internalPostHideActionHTML(p)}
              ${internalPostEditButtonHTML(p)}
              <button data-op="viewInternalPostDetail" data-arg0="${p.id}" class="bg-fuchsia-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-fuchsia-700">📄 Chi tiết</button>
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
function renderInternalNewsFeed() {
  const container = document.getElementById('internalPostsContainer');
  if (!container) return;
  // Khối phân trang của renderInternalPosts ('internal') không dùng ở đây — dọn sạch nếu còn sót lại
  // từ tab khác (Đào tạo/Khen thưởng/Góc chia sẻ đều dùng chung khối đó).
  const paginationEl = document.getElementById('paginationContainer_internal');
  if (paginationEl) paginationEl.innerHTML = '';

  const fromDate = document.getElementById('filterFromDateInternal')?.value || '';
  const toDate = document.getElementById('filterToDateInternal')?.value || '';
  const keyword = (document.getElementById('filterKeywordInternal')?.value || '').trim();

  const canApprove = canApproveInternalPost(currentUser);
  let visible = DB.internalPosts.filter(p => {
    if (p.type !== 'NEWS') return false;
    // Bài KHÔNG phải APPROVED (Nháp/Yêu cầu bổ sung/Đã ẩn) chỉ hiện với chính tác giả/người có quyền
    // duyệt — cùng khuôn renderInternalPosts() ở trên (server đã lọc trước, đây chỉ phòng hờ).
    const isRestrictedStatus = p.status && p.status !== 'APPROVED';
    if (isRestrictedStatus && p.author !== currentUser.username && !canApprove) return false;
    if (!isInDateRange(p.createdAt, fromDate, toDate)) return false;
    if (!matchesKeywordFields([p.title, p.content, p.authorName, p.dept], keyword)) return false;
    return true;
  });

  visible = visible.slice().sort((a, b) => {
    if (internalNewsSortMode === 'popular') {
      const scoreA = (a.likes?.length || 0) + (a.comments?.length || 0);
      const scoreB = (b.likes?.length || 0) + (b.comments?.length || 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
    }
    return b.id - a.id; // mới nhất trước
  });

  // TRƯỚC ĐÂY: cắt cứng 5 bài mới nhất (visible.slice(0, 5)), không phân trang — nay phân trang đầy đủ
  // như mọi danh sách khác trong hệ thống (moduleKey 'internalNews' riêng, xem paginateList() dùng
  // chung), sắp xếp (Mới nhất/Tương tác nhiều) áp dụng TRƯỚC khi cắt trang.
  document.getElementById('paginationContainer_internalNews').innerHTML = buildPaginationBoxHTML('internalNews', 'renderInternalNewsFeed');
  const pageItems = paginateList('internalNews', visible, 'renderInternalNewsFeed', 'bài viết');

  const sortBarHTML = `
    <div class="flex items-center justify-between mb-3">
      <div class="text-xs text-gray-500">Tổng ${visible.length} tin</div>
      <div class="flex gap-1">
        <button data-op="setInternalNewsSort" data-arg0="recent" class="px-2.5 py-1 rounded text-xs font-bold ${internalNewsSortMode === 'recent' ? 'bg-fuchsia-700 text-white' : 'bg-gray-200 text-gray-700'}">🕐 Mới nhất</button>
        <button data-op="setInternalNewsSort" data-arg0="popular" class="px-2.5 py-1 rounded text-xs font-bold ${internalNewsSortMode === 'popular' ? 'bg-fuchsia-700 text-white' : 'bg-gray-200 text-gray-700'}">🔥 Tương tác nhiều</button>
      </div>
    </div>`;

  if (pageItems.length === 0) {
    container.innerHTML = sortBarHTML + `<div class="text-center p-6 text-gray-500 italic bg-white rounded border">Chưa có tin tức nào phù hợp.</div>`;
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
  const coverHTML = isInternalImageAttachment(p.attachment)
    ? `<img src="${escapeHtml(p.attachment.fileUrl)}" alt="" class="w-full max-h-80 object-cover cursor-pointer" data-op="viewInternalPostDetail" data-arg0="${p.id}">`
    : '';
  const snippet = (p.content || '').slice(0, 300);
  const commentsHTML = shownComments.length
    ? shownComments.map(c => `
        <div class="flex gap-2 text-sm">
          <div class="w-7 h-7 rounded-full bg-fuchsia-200 text-fuchsia-800 flex items-center justify-center font-bold text-xs flex-shrink-0">${escapeHtml((c.name || '?').charAt(0).toUpperCase())}</div>
          <div class="bg-gray-100 rounded-2xl px-3 py-1.5 flex-1">
            <div class="font-bold text-xs text-gray-800">${escapeHtml(c.name || '')}</div>
            <div class="text-gray-700">${escapeHtml(c.content)}</div>
            <div class="mt-0.5">${internalCommentLikeButtonHTML(p.id, c)}</div>
          </div>
        </div>`).join('')
    : `<div class="text-xs text-gray-400 italic">Chưa có bình luận nào — hãy là người đầu tiên!</div>`;
  const expandToggleHTML = comments.length > shownComments.length
    ? `<button data-op="toggleInternalCommentsExpanded" data-arg0="${p.id}" class="text-xs text-fuchsia-700 font-bold hover:underline mb-2">Xem tất cả ${comments.length} bình luận →</button>`
    : (expanded && comments.length > 5 ? `<button data-op="toggleInternalCommentsExpanded" data-arg0="${p.id}" class="text-xs text-gray-500 hover:underline mb-2">Thu gọn bình luận</button>` : '');
  const statusBadgeHTML = internalPostStatusBadgeHTML(p);
  const editHideActionsHTML = (internalPostEditButtonHTML(p) || internalPostHideActionHTML(p))
    ? `<div class="flex gap-2 flex-wrap mb-2">${internalPostEditButtonHTML(p)}${internalPostHideActionHTML(p)}</div>`
    : '';

  return `
    <div class="bg-white rounded border hover:shadow mb-3">
      ${coverHTML}
      <div class="p-4">
        <div class="font-bold text-fuchsia-800 text-base cursor-pointer hover:underline" data-op="viewInternalPostDetail" data-arg0="${p.id}">${escapeHtml(p.title)}${statusBadgeHTML}</div>
        <div class="text-xs text-gray-500 mt-0.5">${escapeHtml(p.authorName)} (${escapeHtml(p.dept)}) — ${escapeHtml(p.createdAt)}</div>
        ${internalPostInfoRequestBannerHTML(p)}
        <p class="text-sm text-gray-700 mt-2">${escapeHtml(snippet)}${(p.content || '').length > 300 ? '… ' : ' '}<span class="text-fuchsia-700 font-bold cursor-pointer hover:underline" data-op="viewInternalPostDetail" data-arg0="${p.id}">Xem thêm</span></p>
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
          <input id="internalCommentInput_${p.id}" type="text" placeholder="Viết bình luận..." class="flex-1 border rounded-full px-3 py-1.5 text-sm" onkeydown="if(event.key==='Enter'){event.preventDefault();addInternalCommentInline(${p.id});}">
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
  renderInternalNewsFeed();
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
  renderInternalNewsFeed();
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
  const editHideActionsHTML = (internalPostEditButtonHTML(p) || internalPostHideActionHTML(p))
    ? `<div class="flex gap-2 flex-wrap mb-3">${internalPostEditButtonHTML(p)}${internalPostHideActionHTML(p)}</div>`
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
          <div class="text-gray-800 mt-0.5">${escapeHtml(c.content)}</div>
          <div class="mt-1">${internalCommentLikeButtonHTML(p.id, c)}</div>
        </div>
      `).join('')
    : '<div class="text-gray-400 italic text-xs">Chưa có bình luận nào.</div>';
  const expandToggleDetailHTML = allComments.length > shownComments.length
    ? `<button data-op="toggleInternalCommentsExpandedAndView" data-arg0="${p.id}" class="text-xs text-fuchsia-700 font-bold hover:underline">Xem tất cả ${allComments.length} bình luận →</button>`
    : (expandedDetail && allComments.length > 5 ? `<button data-op="toggleInternalCommentsExpandedAndView" data-arg0="${p.id}" class="text-xs text-gray-500 hover:underline">Thu gọn bình luận</button>` : '');

  const isImg = isInternalImageAttachment(p.attachment);
  const coverHTML = isImg ? `<img src="${escapeHtml(p.attachment.fileUrl)}" alt="" class="w-full max-h-96 object-cover">` : '';
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
      <div class="whitespace-pre-wrap text-gray-800">${escapeHtml(p.content)}</div>
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
          <input id="internalCommentInput" placeholder="Viết bình luận..." class="flex-1 border p-1.5 rounded text-xs" onkeydown="if(event.key==='Enter'){event.preventDefault(); addInternalComment(${p.id});}">
          <button data-op="addInternalComment" data-arg0="${p.id}" class="bg-fuchsia-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-fuchsia-700">Gửi</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('internalArticleModal').classList.remove('hidden');
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

