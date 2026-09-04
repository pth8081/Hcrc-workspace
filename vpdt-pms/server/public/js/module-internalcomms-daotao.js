// ===================== ĐÀO TẠO (module con "Truyền Thông Nội Bộ" > Đào tạo) =====================
// LMS: Lớp Học (tạo/danh sách/ghi nhận kết quả) + Đăng Ký Của Tôi + Kho Tài Liệu (theo loại) +
// Lộ Trình Thăng Tiến (danh sách lớp bắt buộc, chỉ "Xác nhận" được khi Đạt hết — xem
// confirmCareerPathForEmployee(), lib/recordActions.js) + Ngân Hàng Câu Hỏi.
// Đợt 3: internalTrainingCreate cũ tách thành trainingManage (TOÀN QUYỀN — tạo mới lớp/tài liệu/bài
// test/lộ trình, quản lý roster/kết quả BẤT KỲ lớp nào) + trainingInstruct (KHÔNG tạo lớp/quản lý lộ
// trình/ngân hàng câu hỏi được, chỉ quản lý roster/kết quả của ĐÚNG lớp mình được gán làm giảng viên —
// xem canManageTrainingClassLocal() ngay dưới, mirrors canManageTrainingClass() ở lib/recordActions.js).
// canManageTrainingLocal() dùng cho các hành động KHÔNG theo từng lớp (tạo mới lớp/tài liệu/bài
// test/lộ trình) — CHỈ trainingManage mới được, trainingInstruct KHÔNG đủ.
function canManageTrainingLocal(user) {
  return !!(user.perms?.admin || user.perms?.trainingManage);
}

// Quyền quản lý MỘT lớp học cụ thể (roster/kết quả/sửa nội dung/Bắt Đầu-Kết Thúc Lớp) — mirrors
// canManageTrainingClass() ở lib/recordActions.js Y HỆT (xem "LƯU Ý BẢO TRÌ" đầu file
// lib/createValidation.js: 2 cài đặt độc lập, client/server không import chung được).
function canManageTrainingClassLocal(user, cls) {
  if (user?.perms?.admin || user?.perms?.trainingManage) return true;
  return !!(user?.perms?.trainingInstruct && cls?.instructorUsername && cls.instructorUsername === user.username);
}

// Trạng thái buổi học hiển thị (Đợt 3) — KHÁC hẳn cls.status (còn mở/đóng ĐĂNG KÝ). ONLINE tính SỐNG
// theo giờ hệ thống ngay lúc gọi hàm (không lưu gì — cùng tinh thần pinExpiresAt/publishAt/"Sắp hết
// hạn" tuyển dụng đã có sẵn trong app), OFFLINE đọc thẳng field cls.sessionState đã lưu (chuyển tay qua
// nút Bắt Đầu Lớp/Kết Thúc Lớp — startOfflineTrainingClass()/endOfflineTrainingClass(),
// lib/recordActions.js). Trả về 1 trong 3 giá trị chung: 'SCHEDULED'|'ONGOING'|'ENDED'.
function getTrainingClassSessionState(cls) {
  if (cls.mode === 'OFFLINE') return cls.sessionState || 'SCHEDULED';
  const now = Date.now();
  const start = cls.startTime ? new Date(cls.startTime).getTime() : NaN;
  const end = cls.endTime ? new Date(cls.endTime).getTime() : NaN;
  if (Number.isFinite(start) && now < start) return 'SCHEDULED';
  if (Number.isFinite(end) && now > end) return 'ENDED';
  return 'ONGOING';
}
const TRAINING_SESSION_STATE_LABELS = { SCHEDULED: 'Sắp diễn ra', ONGOING: 'Đang diễn ra', ENDED: 'Đã kết thúc' };

// Trạng thái hiển thị của 1 đăng ký (Đợt 3) — LỚP PHỦ tính toán, KHÔNG đổi trainingRegistrations.result
// gốc (vẫn REGISTERED/PASSED/FAILED/CANCELLED làm nguồn sự thật duy nhất, xem baseline). "Chờ" = đăng ký
// còn REGISTERED và buổi học CHƯA bắt đầu; "Đang học" = REGISTERED và buổi học đã bắt đầu (đang diễn ra
// hoặc đã kết thúc) nhưng chưa có kết quả; "Hoàn thành" = đã có kết quả PASSED/FAILED (kèm sub-badge);
// "Đã hủy" = result CANCELLED, không đụng gì tới sessionState.
function getTrainingRegDisplayStatus(reg, cls) {
  if (reg.result === 'CANCELLED') return { key: 'CANCELLED', label: 'Đã hủy' };
  if (reg.result === 'PASSED' || reg.result === 'FAILED') {
    return { key: 'DONE', label: 'Hoàn thành', sub: reg.result === 'PASSED' ? 'Đạt' : 'Không đạt' };
  }
  const sessionState = cls ? getTrainingClassSessionState(cls) : 'SCHEDULED';
  return sessionState === 'SCHEDULED' ? { key: 'WAITING', label: 'Chờ' } : { key: 'STUDYING', label: 'Đang học' };
}

let activeTrainingLmsTab = 'CLASSES';
function setTrainingLmsTab(tab) {
  activeTrainingLmsTab = tab;
  // Reset trang về 1 khi đổi tab con — mỗi tab có moduleKey phân trang riêng (trainingClasses/
  // trainingCourses/trainingPlans/trainingMyRegs/trainingDocuments/careerPaths/trainingTests), tránh
  // giữ lại trang sâu của tab trước.
  ['trainingClasses', 'trainingCourses', 'trainingPlans', 'trainingMyRegs', 'trainingDocuments', 'careerPaths', 'onboardingPaths', 'onboardingProgress', 'trainingTests'].forEach(resetListPage);
  const btnMap = { DASHBOARD: 'btnTrainingLmsDashboard', CLASSES: 'btnTrainingLmsClasses', COURSES: 'btnTrainingLmsCourses', PLANS: 'btnTrainingLmsPlans', MY_REGS: 'btnTrainingLmsMyRegs', DOCS: 'btnTrainingLmsDocs', PATHS: 'btnTrainingLmsPaths', ONBOARDING: 'btnTrainingLmsOnboarding', TESTS: 'btnTrainingLmsTests' };
  Object.entries(btnMap).forEach(([key, btnId]) => {
    const btn = document.getElementById(btnId);
    if (btn) btn.className = key === tab ? 'px-3 py-1 rounded text-xs font-bold bg-emerald-700 text-white' : 'px-3 py-1 rounded text-xs font-bold bg-gray-200 text-gray-700';
  });
  document.getElementById('trainingLmsDashboardPanel').classList.toggle('hidden', tab !== 'DASHBOARD');
  document.getElementById('trainingLmsClassesPanel').classList.toggle('hidden', tab !== 'CLASSES');
  document.getElementById('trainingLmsCoursesPanel').classList.toggle('hidden', tab !== 'COURSES');
  document.getElementById('trainingLmsPlansPanel').classList.toggle('hidden', tab !== 'PLANS');
  document.getElementById('trainingLmsMyRegsPanel').classList.toggle('hidden', tab !== 'MY_REGS');
  document.getElementById('trainingLmsDocsPanel').classList.toggle('hidden', tab !== 'DOCS');
  document.getElementById('trainingLmsPathsPanel').classList.toggle('hidden', tab !== 'PATHS');
  document.getElementById('trainingLmsOnboardingPanel').classList.toggle('hidden', tab !== 'ONBOARDING');
  document.getElementById('trainingLmsTestsPanel').classList.toggle('hidden', tab !== 'TESTS');
  renderTrainingLms();
}

function populateTrainingCategorySelects() {
  const opts = (DB.trainingCategories || []).map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  ['tcCategory', 'tdCategory', 'tccCategory'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) sel.innerHTML = opts || `<option value="">-- Chưa có loại đào tạo, vào Quản Trị &gt; Quản Lý Danh Mục để thêm --</option>`;
  });
  const filterSel = document.getElementById('trainingDocFilterCategory');
  if (filterSel) filterSel.innerHTML = `<option value="">-- Tất cả loại đào tạo --</option>` + opts;
  const ttSel = document.getElementById('ttCategory');
  if (ttSel) ttSel.innerHTML = `<option value="">-- Không thuộc loại nào --</option>` + opts;
}

// Chương Trình (trainingCourses, Đợt 4) — populate dropdown chọn chương trình (tuỳ chọn) ở form tạo
// lớp học (tcCourseId), form thêm tài liệu (tdCourseId) và form lập Kế Hoạch Đào Tạo (tpCourseId, Đợt 5);
// teCourseId (modal Sửa Lớp Học) populate riêng trong openEditTrainingClassModal() cùng khuôn
// teTestId/teDocumentIds (không qua hàm chung này vì cần set lại value đang có sẵn của lớp ngay sau khi
// populate).
function populateTrainingCourseSelects() {
  const opts = DB.trainingCourses.slice().sort((a, b) => b.id - a.id)
    .map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.category)})</option>`).join('');
  ['tcCourseId', 'tdCourseId', 'tpCourseId'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel) sel.innerHTML = `<option value="">-- Không thuộc chương trình nào --</option>` + opts;
  });
  // Bộ lọc Dashboard (tpDashCourseId, Đợt 5) — giữ lại value đang chọn (không reset về "Tất cả" mỗi lần
  // render lại danh mục chương trình), khác dropdown trong form tạo (luôn reset vì mỗi lần mở form là 1
  // lượt lập kế hoạch mới).
  const dashSel = document.getElementById('tpDashCourseId');
  if (dashSel) {
    const prevValue = dashSel.value;
    dashSel.innerHTML = `<option value="">-- Tất cả chương trình --</option>` + opts;
    if (prevValue && DB.trainingCourses.some(c => String(c.id) === prevValue)) dashSel.value = prevValue;
  }
}

// Đơn Vị (targetDept, trainingPlans Đợt 5) — cùng khuôn rjDept/rjFilterDept (recruitmentJobs): gộp
// DB.depts + DB.stores chung 1 danh sách, không lọc theo scope tạo (lập kế hoạch CHO đơn vị nào là lựa
// chọn tự do của trainingManage, không phải "tạo hồ sơ thay mặt đơn vị khác").
function populateTrainingPlanDeptSelects() {
  const deptOpts = [...DB.depts, ...DB.stores].map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  const formSel = document.getElementById('tpTargetDept');
  if (formSel) {
    const prevValue = formSel.value;
    formSel.innerHTML = `<option value="">-- Không nhắm 1 đơn vị cụ thể --</option>` + deptOpts;
    if ([...DB.depts, ...DB.stores].includes(prevValue)) formSel.value = prevValue;
  }
  const dashSel = document.getElementById('tpDashTargetDept');
  if (dashSel) {
    const prevValue = dashSel.value;
    dashSel.innerHTML = `<option value="">-- Tất cả đơn vị --</option>` + deptOpts;
    if ([...DB.depts, ...DB.stores].includes(prevValue)) dashSel.value = prevValue;
  }
}

function populateTrainingClassMultiSelects() {
  const opts = DB.trainingClasses.slice().sort((a, b) => b.id - a.id)
    .map(c => `<option value="${c.id}">${escapeHtml(c.code || '')} - ${escapeHtml(c.title)} (${escapeHtml(c.category)})</option>`).join('');
  const docOpts = DB.trainingDocuments.slice().sort((a, b) => b.id - a.id)
    .map(d => `<option value="${d.id}">${escapeHtml(d.category)} — ${escapeHtml(d.title)}</option>`).join('');
  const tcDoc = document.getElementById('tcDocumentIds');
  if (tcDoc) tcDoc.innerHTML = docOpts || `<option value="" disabled>-- Kho tài liệu đang trống --</option>`;
  const testOpts = DB.trainingTests.slice().sort((a, b) => b.id - a.id)
    .map(t => `<option value="${t.id}">${escapeHtml(t.title)} (${t.questions.length} câu)</option>`).join('');
  const tcTest = document.getElementById('tcTestId');
  if (tcTest) tcTest.innerHTML = `<option value="">-- Không gán bài test --</option>` + testOpts;
}

// ---------- LỘ TRÌNH THĂNG TIẾN (Đợt 7) — trình dựng "Cấp Bậc" lặp lại, mirror addStepRow()/
// reindexStepRows() của form Quy Trình (workflow) — mỗi hàng là 1 cấp bậc (tên + multi-select
// trainingCourses bắt buộc của ĐÚNG cấp đó), thứ tự hàng trong DOM CHÍNH LÀ thứ tự cấp bậc gửi lên. ----------
function populateCpStageCourseSelectOptions(selectEl) {
  if (!selectEl) return;
  const prevSelected = [...selectEl.selectedOptions].map(o => o.value);
  const opts = DB.trainingCourses.slice().sort((a, b) => b.id - a.id)
    .map(c => `<option value="${c.id}">${escapeHtml(c.name)} (${escapeHtml(c.category)})</option>`).join('');
  selectEl.innerHTML = opts || `<option value="" disabled>-- Chưa có chương trình đào tạo nào để chọn --</option>`;
  [...selectEl.options].forEach(o => { if (prevSelected.includes(o.value)) o.selected = true; });
}

function addCpStageRow(nameVal = '', courseIds = []) {
  const container = document.getElementById('cpStageBuilderContainer');
  if (!container) return;
  const count = container.children.length + 1;
  const div = document.createElement('div');
  div.className = 'cp-stage-row border rounded p-2 bg-gray-50 space-y-1';
  div.innerHTML = `
    <div class="flex items-center gap-2">
      <span class="font-bold text-xs w-16 cp-stage-label">Cấp ${count}:</span>
      <input placeholder="Tên cấp bậc (VD: Trưởng nhóm)" value="${escapeHtml(nameVal)}" class="border p-1 rounded text-xs flex-1 cp-stage-name-input" required>
      <button type="button" data-op="removeCpStageRow" data-arg-el="0" class="text-red-500 font-bold px-2 text-xs">✕ Xóa</button>
    </div>
    <select multiple size="4" class="w-full border p-1 rounded bg-white text-xs cp-stage-course-select" required></select>
  `;
  container.appendChild(div);
  const sel = div.querySelector('.cp-stage-course-select');
  populateCpStageCourseSelectOptions(sel);
  if (courseIds.length) [...sel.options].forEach(o => { if (courseIds.map(String).includes(o.value)) o.selected = true; });
}

function removeCpStageRow(el) { el.closest('.cp-stage-row').remove(); reindexCpStageRows(); }

function reindexCpStageRows() {
  const container = document.getElementById('cpStageBuilderContainer');
  if (!container) return;
  Array.from(container.children).forEach((row, idx) => {
    const lbl = row.querySelector('.cp-stage-label');
    if (lbl) lbl.innerText = `Cấp ${idx + 1}:`;
  });
}

// Gọi mỗi lần renderTrainingLms() — làm mới option chương trình trong các hàng cấp bậc ĐANG có (giữ lại
// lựa chọn đã chọn, cùng tinh thần populateTrainingCourseSelects() dashSel ở trên), và đảm bảo LUÔN có ít
// nhất 1 hàng sẵn để bắt đầu nhập (không xoá các hàng người dùng đang xây dở, khác populateTrainingClassMultiSelects()
// ở trên vốn ghi đè hẳn nội dung select mỗi lần — form Cấp Bậc là 1 danh sách hàng do người dùng tự xây,
// không phải 1 select đơn cần đồng bộ lại với DB mỗi lần render).
function populateCareerPathStageBuilder() {
  const container = document.getElementById('cpStageBuilderContainer');
  if (!container) return;
  container.querySelectorAll('.cp-stage-course-select').forEach(populateCpStageCourseSelectOptions);
  if (!container.children.length) addCpStageRow();
}

function resetCareerPathForm() {
  const form = document.getElementById('careerPathForm');
  if (form) form.reset();
  const container = document.getElementById('cpStageBuilderContainer');
  if (container) container.innerHTML = '';
  addCpStageRow();
}

function renderTrainingLms() {
  // Đào Tạo Đợt 3 dùng chung <datalist id="systemUsersDatalist"> cho #tcInstructor/#tcInviteListPickInput
  // (form Tạo Lớp Mới) và #trRosterPickInput (modal Thêm Học Viên, mở từ bảng lớp học ở đây) — nhưng
  // trước đây KHÔNG có lệnh gọi populateSystemUsersDatalist() nào trên đường vào module này, chỉ được
  // populate "ăn theo" nếu người dùng tình cờ mở Biên Bản Họp/modal Mẫu/sửa lớp học TRƯỚC đó trong cùng
  // phiên. Phiên mới mở thẳng Đào Tạo -> datalist rỗng -> các ô trên "không gõ tìm được" (báo lỗi thật,
  // xem HUONG_DAN_DEPLOY_UBUNTU.md không liên quan). Gọi ngay đầu renderTrainingLms() (chạy mỗi lần vào
  // module + mỗi lần đổi sub-tab, xem setTrainingLmsTab()) để đảm bảo luôn có dữ liệu trước khi các ô
  // trên có thể hiện ra.
  populateSystemUsersDatalist();
  populateTrainingCategorySelects();
  populateTrainingClassMultiSelects();
  populateTrainingCourseSelects();
  populateTrainingPlanDeptSelects();
  onTrainingClassModeChange(); // đồng bộ lại ẩn/hiện Giảng Viên+Địa Điểm theo đúng #tcMode hiện tại (mặc định Online)
  const canManage = canManageTrainingLocal(currentUser);
  // Dashboard (thẻ tổng hợp + bảng "Top Điểm Cao Nhất"): trước đây hiện cho MỌI người vào được module,
  // khác mọi khối quản lý còn lại trên màn hình này (đều gác canManage) — cả 2 nguồn dữ liệu thẻ tổng
  // hợp dùng (trainingRegistrations) lẫn bảng xếp hạng (trainingTestSubmissions) giờ đã bị lọc quyền ở
  // server (chỉ trainingManage/giảng viên đúng lớp/chính chủ mới thấy đủ, xem
  // lib/recordViewScope.js) — nhân viên thường sẽ chỉ thấy đúng 1 dòng của mình, số liệu tổng hợp sai
  // lệch/gây hiểu nhầm nếu vẫn hiện tab này cho họ. Gác lại đúng canManage cho nhất quán.
  document.getElementById('btnTrainingLmsDashboard').classList.toggle('hidden', !canManage);
  // Không gọi setTrainingLmsTab() ở đây (sẽ đệ quy vô hạn — chính hàm đó gọi lại renderTrainingLms() ở
  // cuối) — chỉ cần ẩn nút+panel, tab mặc định khi mở module (activeTrainingLmsTab = 'CLASSES') đã
  // không phải DASHBOARD nên trường hợp còn kẹt ở tab này chỉ xảy ra nếu quyền bị thu hồi NGAY khi đang
  // mở đúng tab đó (hiếm), không đáng để thêm phức tạp xử lý.
  if (!canManage && activeTrainingLmsTab === 'DASHBOARD') activeTrainingLmsTab = 'CLASSES';
  document.getElementById('trainingClassForm').classList.toggle('hidden', !canManage);
  document.getElementById('trainingClassNoPermNote').classList.toggle('hidden', canManage);
  // Chương Trình (Đợt 4) — catalog quản lý CHỈ trainingManage (kể cả giảng viên đã có trainingInstruct
  // cũng không tạo/xoá được, chỉ ĐỌC danh sách khi tạo/sửa lớp mình phụ trách — xem ghi chú
  // createValidation.js).
  document.getElementById('trainingCourseForm').classList.toggle('hidden', !canManage);
  document.getElementById('trainingCourseNoPermNote').classList.toggle('hidden', canManage);
  // Kế Hoạch Đào Tạo (Đợt 5) — cùng gác quyền CHỈ trainingManage như Chương Trình ở trên.
  document.getElementById('trainingPlanForm').classList.toggle('hidden', !canManage);
  document.getElementById('trainingPlanNoPermNote').classList.toggle('hidden', canManage);
  document.getElementById('trainingPlanImportSection').classList.toggle('hidden', !canManage);
  document.getElementById('trainingDocForm').classList.toggle('hidden', !canManage);
  document.getElementById('trainingDocNoPermNote').classList.toggle('hidden', canManage);
  document.getElementById('careerPathForm').classList.toggle('hidden', !canManage);
  document.getElementById('careerPathNoPermNote').classList.toggle('hidden', canManage);
  populateCareerPathStageBuilder();
  document.getElementById('trainingTestForm').classList.toggle('hidden', !canManage);
  document.getElementById('trainingTestNoPermNote').classList.toggle('hidden', canManage);
  // Đào Tạo Tân Binh (Đợt 6) — Khối 1/2 (quản lý danh mục Lộ Trình + Phân Công) CHỈ trainingManage/admin
  // như mọi catalog khác ở trên; Khối 3 (Lộ Trình Của Tôi)/Khối 4 (Đánh Giá GĐ3) có điều kiện hiện riêng,
  // không đi theo canManage — xem renderOnboardingLms().
  document.getElementById('onboardingPathForm').classList.toggle('hidden', !canManage);
  document.getElementById('onboardingPathNoPermNote').classList.toggle('hidden', canManage);
  document.getElementById('onboardingAssignForm').classList.toggle('hidden', !canManage);
  document.getElementById('onboardingAssignNoPermNote').classList.toggle('hidden', canManage);
  renderTrainingInviteListStagedList();

  if (activeTrainingLmsTab === 'DASHBOARD') renderTrainingDashboard();
  else if (activeTrainingLmsTab === 'CLASSES') renderTrainingClasses();
  else if (activeTrainingLmsTab === 'COURSES') renderTrainingCourses();
  else if (activeTrainingLmsTab === 'PLANS') { renderTrainingPlans(); renderTrainingPlanDashboard(); }
  else if (activeTrainingLmsTab === 'MY_REGS') renderTrainingMyRegs();
  else if (activeTrainingLmsTab === 'DOCS') renderTrainingDocuments();
  else if (activeTrainingLmsTab === 'PATHS') renderCareerPaths();
  else if (activeTrainingLmsTab === 'ONBOARDING') renderOnboardingLms();
  else if (activeTrainingLmsTab === 'TESTS') renderTrainingTests();
}

// ---------- LỚP HỌC ----------
// Online: giáo trình trong tcDocumentIds là bắt buộc đọc trước khi học. Offline: chỉ là tài liệu tham
// khảo để giảng viên tự mở khi lên lớp (họ có thể mở file bên ngoài nếu không dùng) — đổi nhãn cho đúng
// kỳ vọng, KHÔNG đổi field/hành vi lưu (vẫn cùng 1 documentIds).
function onTrainingClassModeChange() {
  const mode = document.getElementById('tcMode').value;
  document.getElementById('tcDocumentIdsLabel').innerText = mode === 'OFFLINE'
    ? 'Giáo Trình Tham Khảo Cho Giảng Viên (không bắt buộc học viên đọc trước, chọn từ Kho Tài Liệu)'
    : 'Giáo Trình Đọc Bắt Buộc (chọn từ Kho Tài Liệu, giữ Ctrl/Cmd để chọn nhiều)';
  // Lớp Online không cần giảng viên đứng lớp/phòng học vật lý — ẩn 2 ô này khi chọn Online, xoá luôn
  // giá trị đang gõ dở (nếu người dùng vừa nhập rồi mới đổi qua Online) để không gửi lên nhầm dữ liệu
  // không còn ý nghĩa. Chuyển lại Offline thì hiện lại, để trống cho tự nhập lại (không cố nhớ giá trị cũ).
  const isOnline = mode === 'ONLINE';
  document.getElementById('tcInstructorFieldWrap').classList.toggle('hidden', isOnline);
  document.getElementById('tcLocationFieldWrap').classList.toggle('hidden', isOnline);
  if (isOnline) {
    document.getElementById('tcInstructor').value = '';
    document.getElementById('tcInstructorUsername').value = '';
    document.getElementById('tcLocation').value = '';
  }
}

// Autofill tiện lợi khi chọn Bài Test lúc tạo/sửa lớp — người quản lý thường không nhớ nổi từng bài
// test yêu cầu bao nhiêu điểm, nên lấy passScore GỢI Ý đã lập ở Ngân Hàng Câu Hỏi (trainingTests.passScore)
// điền sẵn vào ô Điểm Đạt Yêu Cầu của LỚP. Đây chỉ là default UI — KHÔNG phải nguồn quyết định (server
// vẫn luôn đọc/validate cls.passScore của chính lớp, xem createValidation.js). Chỉ điền khi ô đang TRỐNG,
// để không âm thầm ghi đè giá trị người dùng đã tự nhập/lớp đã có sẵn (vd đang sửa lớp cũ).
function applyTrainingClassTestDefaultPassScore(testSelectId, passScoreInputId) {
  const testSelect = document.getElementById(testSelectId);
  const passScoreInput = document.getElementById(passScoreInputId);
  if (!testSelect || !passScoreInput) return;
  if (passScoreInput.value !== '') return;
  const testId = testSelect.value === '' ? null : Number(testSelect.value);
  if (testId == null) return;
  const test = DB.trainingTests.find(t => t.id === testId);
  if (test && test.passScore != null) passScoreInput.value = test.passScore;
}

// Giảng viên (Đợt 3) — cùng khuôn resolveCarAssignedDriverInput() ở trên: khớp đúng định dạng
// "Tên — Phòng (tài_khoản)" của <datalist id="systemUsersDatalist">, gõ tự do không khớp -> để trống,
// submit sẽ bị chặn nếu ô còn text nhưng chưa resolve được (server cũng tự xác thực lại, xem
// createValidation.js resolveTrainingInstructorUsername()).
function resolveTrainingInstructorInput(rawValue) {
  const m = rawValue.match(/^(.*) — .*\(([^()]+)\)$/);
  document.getElementById('tcInstructorUsername').value = m ? m[2].trim() : '';
}

// Danh Sách Được Mời (tuỳ chọn, Đợt 3) — cùng khuôn trainingRosterStaged (picker thêm học viên), nhưng
// đây chỉ GHI vào field inviteList của lớp lúc tạo/sửa, KHÔNG tự đăng ký/enroll ai cả.
let tcInviteListStaged = []; // [{ username, name, dept }]
function renderTrainingInviteListStagedList() {
  const wrap = document.getElementById('tcInviteListStagedList');
  if (!wrap) return;
  if (!tcInviteListStaged.length) {
    wrap.innerHTML = `<span class="text-gray-400 italic text-xs">Chưa mời ai — để trống thì mọi người đều tự đăng ký được.</span>`;
    return;
  }
  wrap.innerHTML = tcInviteListStaged.map(p => `
    <span class="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 text-indigo-800 rounded-full pl-2 pr-1 py-0.5 text-xs">
      ${escapeHtml(p.name)}${p.dept ? ` <span class="text-indigo-500">(${escapeHtml(p.dept)})</span>` : ''}
      <button type="button" data-op="removeTrainingInviteListStaged" data-arg0="${escapeHtml(p.username)}" class="text-indigo-500 hover:text-red-600 font-bold leading-none px-1">&times;</button>
    </span>`).join('');
}
function addTrainingInviteListPick() {
  const input = document.getElementById('tcInviteListPickInput');
  const raw = input.value.trim();
  if (!raw) return;
  const m = raw.match(/^(.*) — .*\(([^()]+)\)$/);
  const user = m ? DB.users.find(u => u.username === m[2].trim()) : DB.users.find(u => u.username === raw);
  if (!user) return alert('Không tìm thấy tài khoản này trong danh sách gợi ý — vui lòng chọn đúng từ dropdown.');
  if (!tcInviteListStaged.some(p => p.username === user.username)) {
    tcInviteListStaged.push({ username: user.username, name: user.name, dept: user.dept });
  }
  renderTrainingInviteListStagedList();
  input.value = '';
  input.focus();
}
function removeTrainingInviteListStaged(username) {
  tcInviteListStaged = tcInviteListStaged.filter(p => p.username !== username);
  renderTrainingInviteListStagedList();
}

async function submitTrainingClass(e) {
  e.preventDefault();
  if (!canManageTrainingLocal(currentUser)) return alert('⛔ Bạn không có quyền tạo lớp học!');
  const instructorText = document.getElementById('tcInstructor').value.trim();
  const instructorUsername = document.getElementById('tcInstructorUsername').value;
  if (instructorText && !instructorUsername) {
    return alert('Vui lòng chọn đúng giảng viên từ danh sách gợi ý (gõ tên hoặc tài khoản để tìm), hoặc để trống nếu chưa gán!');
  }
  const documentIds = [...document.getElementById('tcDocumentIds').selectedOptions].map(o => Number(o.value));
  const payload = {
    code: `LOP-${Date.now()}`,
    category: document.getElementById('tcCategory').value,
    title: document.getElementById('tcTitle').value.trim(),
    instructor: instructorText,
    instructorUsername,
    startTime: document.getElementById('tcStart').value,
    endTime: document.getElementById('tcEnd').value,
    location: document.getElementById('tcLocation').value.trim(),
    mode: document.getElementById('tcMode').value,
    registerDeadline: document.getElementById('tcDeadline').value,
    capacity: document.getElementById('tcCapacity').value,
    passScore: document.getElementById('tcPassScore').value,
    testId: document.getElementById('tcTestId').value,
    testSecondsPerQuestion: document.getElementById('tcTestSecondsPerQuestion').value,
    documentIds,
    description: document.getElementById('tcDescription').value.trim(),
    inviteList: tcInviteListStaged.map(p => p.username),
    courseId: document.getElementById('tcCourseId').value
  };
  if (!payload.category) return alert('Vui lòng chọn Loại Đào Tạo (thêm ở Quản Trị &gt; Quản Lý Danh Mục nếu chưa có)!');
  // Lớp có gán Bài Test thì bắt buộc nhập Điểm Đạt (server tự xác minh lại y hệt ở
  // createValidation.js trainingClasses.extraValidate — đây chỉ là chặn sớm cho trải nghiệm mượt).
  if (payload.testId) {
    const ps = Number(payload.passScore);
    if (payload.passScore === '' || !Number.isFinite(ps) || ps <= 0 || ps > 100) {
      return alert('⛔ Lớp có gán Bài Test cần nhập Điểm Đạt Yêu Cầu hợp lệ (1-100)!');
    }
  }
  let newClass;
  try {
    const result = await callCreateAction('trainingClasses', payload);
    newClass = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  DB.trainingClasses.unshift(newClass);
  logSystemAction('INTERNAL', 'CREATE_TRAINING_CLASS', `Tạo lớp học đào tạo [${newClass.code} - ${newClass.title}]`, 'SUCCESS', newClass.code);
  alert('✅ Đã tạo lớp học thành công!');
  e.target.reset();
  document.getElementById('tcInstructorUsername').value = '';
  tcInviteListStaged = [];
  renderTrainingInviteListStagedList();
  onTrainingClassModeChange();
  renderTrainingLms();
}

// Dashboard tổng quan Đào Tạo (sub-tab DASHBOARD) — tính trực tiếp từ DB.trainingClasses/
// trainingRegistrations/trainingTestSubmissions đã tải sẵn, đúng quy ước "live-compute, không cache"
// dùng xuyên suốt module này (cùng khuôn computeTrainingPlanDashboard()). Không có chiều bấm-để-lọc
// (khác các dashboard phê duyệt khác) vì đây là thống kê tổng quan, không phải hàng chờ xử lý.
function computeTrainingDashboard() {
  const classes = DB.trainingClasses || [];
  const regs = (DB.trainingRegistrations || []).filter(r => r.result !== 'CANCELLED');
  const ongoingClasses = classes.filter(c => getTrainingClassSessionState(c) === 'ONGOING').length;
  const endedClasses = classes.filter(c => getTrainingClassSessionState(c) === 'ENDED').length;
  const completedPeople = new Set(regs.filter(r => r.result === 'PASSED').map(r => r.creator)).size;
  const topScores = (DB.trainingTestSubmissions || [])
    .slice()
    .sort((a, b) => (b.percentage || 0) - (a.percentage || 0))
    .slice(0, 10);
  return {
    totalClasses: classes.length,
    totalRegistrations: regs.length,
    ongoingClasses,
    endedClasses,
    completedPeople,
    topScores
  };
}

function renderTrainingDashboard() {
  const stats = computeTrainingDashboard();
  const cardsEl = document.getElementById('trainingDashboardCards');
  if (cardsEl) {
    cardsEl.innerHTML = `
      <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div class="bg-white border border-emerald-200 rounded p-3 text-center">
          <div class="text-xs text-gray-600">Tổng Số Lớp Học</div>
          <div class="font-bold text-lg text-emerald-800">${stats.totalClasses.toLocaleString('vi-VN')}</div>
        </div>
        <div class="bg-white border border-sky-200 rounded p-3 text-center">
          <div class="text-xs text-gray-600">Số Lượt Đăng Ký</div>
          <div class="font-bold text-lg text-sky-800">${stats.totalRegistrations.toLocaleString('vi-VN')}</div>
        </div>
        <div class="bg-white border border-amber-200 rounded p-3 text-center">
          <div class="text-xs text-gray-600">Lớp Đang Học</div>
          <div class="font-bold text-lg text-amber-800">${stats.ongoingClasses.toLocaleString('vi-VN')}</div>
        </div>
        <div class="bg-white border border-gray-300 rounded p-3 text-center">
          <div class="text-xs text-gray-600">Lớp Đã Kết Thúc</div>
          <div class="font-bold text-lg text-gray-700">${stats.endedClasses.toLocaleString('vi-VN')}</div>
        </div>
        <div class="bg-white border border-violet-200 rounded p-3 text-center">
          <div class="text-xs text-gray-600">Người Đã Hoàn Thành</div>
          <div class="font-bold text-lg text-violet-800">${stats.completedPeople.toLocaleString('vi-VN')}</div>
        </div>
      </div>
    `;
  }

  const topBody = document.getElementById('trainingTopScoresBody');
  if (topBody) {
    if (!stats.topScores.length) {
      topBody.innerHTML = `<tr><td colspan="5" class="text-center p-6 text-gray-500 italic">Chưa có bài làm test nào.</td></tr>`;
    } else {
      topBody.innerHTML = stats.topScores.map((s, idx) => `
        <tr class="hover:bg-gray-50 border-b">
          <td class="border p-2 font-bold text-center">${idx + 1}</td>
          <td class="border p-2">${escapeHtml(s.name || s.username || '')}<br><span class="text-xs text-gray-500">${escapeHtml(s.dept || '')}</span></td>
          <td class="border p-2">${escapeHtml(s.testTitle || '')}</td>
          <td class="border p-2">${escapeHtml(s.className || '')}</td>
          <td class="border p-2 font-bold text-emerald-700">${Math.round(s.percentage || 0)}%</td>
        </tr>
      `).join('');
    }
  }
}

function renderTrainingClasses() {
  renderTrainingCancelRequestsQueue();
  const tbody = document.getElementById('trainingClassesTableBody');
  if (!tbody) return;
  const list = DB.trainingClasses.slice().sort((a, b) => b.id - a.id);

  document.getElementById('paginationContainer_trainingClasses').innerHTML = buildPaginationBoxHTML('trainingClasses', 'renderTrainingClasses');
  const pageItems = paginateList('trainingClasses', list, 'renderTrainingClasses', 'lớp học');

  if (!pageItems.length) { tbody.innerHTML = `<tr><td colspan="5" class="text-center p-4 text-gray-400 italic">Chưa có lớp học nào.</td></tr>`; return; }
  const todayStr = new Date().toISOString().slice(0, 10);
  tbody.innerHTML = pageItems.map(c => {
    const regs = DB.trainingRegistrations.filter(r => r.classId === c.id && r.result !== 'CANCELLED');
    const myReg = regs.find(r => r.creator === currentUser.username);
    const isFull = c.capacity > 0 && regs.length >= c.capacity;
    const isPastDeadline = !!(c.registerDeadline && todayStr > c.registerDeadline);
    // Đợt 3: canManageTrainingClassLocal() thay hẳn kiểu so "c.creator === currentUser.username" cũ —
    // trainingManage quản lý được MỌI lớp, trainingInstruct chỉ đúng lớp mình được gán làm giảng viên.
    const canManageThis = canManageTrainingClassLocal(currentUser, c);
    const inviteList = Array.isArray(c.inviteList) ? c.inviteList : [];
    const isInvited = !inviteList.length || inviteList.includes(currentUser.username) || currentUser.perms?.admin;
    let actionHTML;
    if (myReg) {
      const disp = getTrainingRegDisplayStatus(myReg, c);
      const cls = disp.key === 'DONE' ? (myReg.result === 'PASSED' ? 'text-emerald-600' : 'text-red-600') : disp.key === 'CANCELLED' ? 'text-gray-400' : 'text-indigo-600';
      actionHTML = `<span class="text-xs font-bold ${cls}">📌 ${escapeHtml(disp.label)}${disp.sub ? ` (${escapeHtml(disp.sub)})` : ''}</span>`;
    } else if (!isInvited) {
      actionHTML = `<span class="text-xs text-gray-400 italic">Lớp này giới hạn theo danh sách mời.</span>`;
    } else if (c.status !== 'OPEN' || isFull || isPastDeadline) {
      actionHTML = `<span class="text-xs text-gray-400">${c.status !== 'OPEN' ? 'Đã đóng' : isFull ? 'Đã đủ số lượng' : 'Hết hạn đăng ký'}</span>`;
    } else {
      actionHTML = `<button data-op="registerForTrainingClass" data-arg0="${c.id}" class="bg-emerald-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-emerald-700">Đăng Ký</button>`;
    }
    const qrHTML = (canManageThis && c.mode === 'OFFLINE' && c.testId != null)
      ? `<button data-op="openTrainingClassQrModal" data-arg0="${c.id}" class="bg-purple-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-purple-700 ml-1">📱 Mã QR</button>` : '';
    // Bắt Đầu Lớp/Kết Thúc Lớp (Đợt 3) — chỉ lớp OFFLINE, vòng đời SCHEDULED -> ONGOING -> ENDED.
    let sessionBtnHTML = '';
    if (canManageThis && c.mode === 'OFFLINE') {
      if (c.sessionState === 'ONGOING') {
        sessionBtnHTML = `<button data-op="endOfflineTrainingClassAction" data-arg0="${c.id}" class="bg-rose-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-rose-700 ml-1">⏹️ Kết Thúc Lớp</button>`;
      } else if (!c.sessionState || c.sessionState === 'SCHEDULED') {
        sessionBtnHTML = `<button data-op="startOfflineTrainingClassAction" data-arg0="${c.id}" class="bg-amber-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-amber-700 ml-1">▶️ Bắt Đầu Lớp</button>`;
      }
    }
    const editHTML = canManageThis
      ? `<button data-op="openEditTrainingClassModal" data-arg0="${c.id}" class="bg-gray-500 text-white px-2 py-1 rounded text-xs font-bold hover:bg-gray-600 ml-1">✏️ Sửa</button>` : '';
    const manageHTML = canManageThis ? `<button data-op="openTrainingResultsModal" data-arg0="${c.id}" class="bg-indigo-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-indigo-700 ml-1">👥 Kết Quả (${regs.length})</button><button data-op="openTrainingRosterModal" data-arg0="${c.id}" class="bg-teal-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-teal-700 ml-1">➕ Thêm Học Viên</button>${qrHTML}${sessionBtnHTML}${editHTML}` : '';
    const delHTML = currentUser.perms?.admin ? `<button data-op="deleteTrainingClass" data-arg0="${c.id}" class="text-red-500 font-bold hover:underline text-xs ml-2">Xóa</button>` : '';
    const sessionState = getTrainingClassSessionState(c);
    const sessionBadgeCls = sessionState === 'ONGOING' ? 'bg-emerald-100 text-emerald-700' : sessionState === 'ENDED' ? 'bg-gray-200 text-gray-600' : 'bg-amber-100 text-amber-700';
    // Chương Trình (courseId, Đợt 4, tuỳ chọn) — CHỈ hiển thị bổ sung, KHÔNG thay thế c.title (tên hiển
    // thị riêng của lần chạy lớp này, xem ghi chú createValidation.js).
    const course = c.courseId != null ? DB.trainingCourses.find(x => x.id === c.courseId) : null;
    return `
      <tr class="hover:bg-gray-50">
        <td class="border p-2"><span class="font-bold text-emerald-800">${escapeHtml(c.code || '')}</span> <span class="text-xs px-1.5 py-0.5 rounded ${c.mode === 'OFFLINE' ? 'bg-orange-100 text-orange-700' : 'bg-sky-100 text-sky-700'}">${c.mode === 'OFFLINE' ? '🏫 Offline' : '💻 Online'}</span> <span class="text-xs px-1.5 py-0.5 rounded ${sessionBadgeCls}">${TRAINING_SESSION_STATE_LABELS[sessionState]}</span>${c.testId ? ' <span class="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">🧪 Có bài test</span>' : ''}${inviteList.length ? ' <span class="text-xs px-1.5 py-0.5 rounded bg-fuchsia-100 text-fuchsia-700">✉️ Có danh sách mời</span>' : ''}<br>${escapeHtml(c.title)}${c.instructor ? `<br><span class="text-gray-400">GV: ${escapeHtml(c.instructor)}</span>` : ''}${course ? `<br><span class="text-gray-400">Chương trình: ${escapeHtml(course.name)}</span>` : ''}</td>
        <td class="border p-2">${escapeHtml(c.category)}</td>
        <td class="border p-2">${escapeHtml((c.startTime || '').replace('T', ' '))}${c.location ? `<br><span class="text-gray-400">${escapeHtml(c.location)}</span>` : ''}</td>
        <td class="border p-2">${regs.length}${c.capacity ? '/' + c.capacity : ''}</td>
        <td class="border p-2 text-center">${actionHTML}${manageHTML}${delHTML}</td>
      </tr>`;
  }).join('');
}

async function startOfflineTrainingClassAction(classId) {
  let updated;
  try {
    const res = await callRecordAction('trainingClasses', classId, 'start-session', {});
    updated = res.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.trainingClasses.findIndex(x => x.id === classId);
  if (idx !== -1) DB.trainingClasses[idx] = updated;
  logSystemAction('INTERNAL', 'START_TRAINING_CLASS_SESSION', `Bắt đầu buổi học [${updated.code}]`, 'SUCCESS', updated.code);
  renderTrainingClasses();
}
async function endOfflineTrainingClassAction(classId) {
  let updated;
  try {
    const res = await callRecordAction('trainingClasses', classId, 'end-session', {});
    updated = res.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.trainingClasses.findIndex(x => x.id === classId);
  if (idx !== -1) DB.trainingClasses[idx] = updated;
  logSystemAction('INTERNAL', 'END_TRAINING_CLASS_SESSION', `Kết thúc buổi học [${updated.code}]`, 'SUCCESS', updated.code);
  renderTrainingClasses();
}

// ---------- SỬA LỚP HỌC (Đợt 3) ----------
function resolveTrainingEditInstructorInput(rawValue) {
  const m = rawValue.match(/^(.*) — .*\(([^()]+)\)$/);
  document.getElementById('teInstructorUsername').value = m ? m[2].trim() : '';
}

let teInviteListStaged = []; // [{ username, name, dept }]
function renderTrainingEditInviteListStagedList() {
  const wrap = document.getElementById('teInviteListStagedList');
  if (!wrap) return;
  if (!teInviteListStaged.length) {
    wrap.innerHTML = `<span class="text-gray-400 italic text-xs">Chưa mời ai — để trống thì mọi người đều tự đăng ký được.</span>`;
    return;
  }
  wrap.innerHTML = teInviteListStaged.map(p => `
    <span class="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 text-indigo-800 rounded-full pl-2 pr-1 py-0.5 text-xs">
      ${escapeHtml(p.name)}${p.dept ? ` <span class="text-indigo-500">(${escapeHtml(p.dept)})</span>` : ''}
      <button type="button" data-op="removeTrainingEditInviteListStaged" data-arg0="${escapeHtml(p.username)}" class="text-indigo-500 hover:text-red-600 font-bold leading-none px-1">&times;</button>
    </span>`).join('');
}
function addTrainingEditInviteListPick() {
  const input = document.getElementById('teInviteListPickInput');
  const raw = input.value.trim();
  if (!raw) return;
  const m = raw.match(/^(.*) — .*\(([^()]+)\)$/);
  const user = m ? DB.users.find(u => u.username === m[2].trim()) : DB.users.find(u => u.username === raw);
  if (!user) return alert('Không tìm thấy tài khoản này trong danh sách gợi ý — vui lòng chọn đúng từ dropdown.');
  if (!teInviteListStaged.some(p => p.username === user.username)) {
    teInviteListStaged.push({ username: user.username, name: user.name, dept: user.dept });
  }
  renderTrainingEditInviteListStagedList();
  input.value = '';
  input.focus();
}
function removeTrainingEditInviteListStaged(username) {
  teInviteListStaged = teInviteListStaged.filter(p => p.username !== username);
  renderTrainingEditInviteListStagedList();
}

// Import Từ Excel + Xuất Excel cho "Danh Sách Được Mời" (cả form Tạo tc*/Sửa te*) — tái dùng NGUYÊN 2
// route đã có sẵn cho modal "Thêm Học Viên" (/api/training/roster-template + /api/training/parse-roster,
// xem routes/trainingRoster.js): file mẫu chỉ có cột "Tài Khoản Đăng Nhập" chung, không có gì riêng cho
// khái niệm "học viên" cả nên dùng lại được thẳng, không cần route mới. Dùng 1 cặp hàm parameterized theo
// prefix ('tc'|'te') thay vì chép đôi như các hàm addTrainingInviteListPick/addTrainingEditInviteListPick
// ở trên (giữ đúng khuôn cũ vì đã có sẵn trước đợt này) — vì khối import/export không có state riêng gắn
// theo prefix (chỉ đọc/ghi đúng đúng mảng staged theo prefix), tách hàm chung an toàn hơn chép nguyên khối.
let tcInviteFilePreviewItems = [];
let teInviteFilePreviewItems = [];

async function onTrainingInviteFileChange(event, prefix) {
  const file = event.target.files[0];
  const statusEl = document.getElementById(`${prefix}InviteFileStatus`);
  const previewWrap = document.getElementById(`${prefix}InviteFilePreviewWrap`);
  const previewBody = document.getElementById(`${prefix}InviteFilePreviewBody`);
  const addBtn = document.getElementById(`${prefix}InviteFileAddBtn`);
  previewWrap.classList.add('hidden');
  addBtn.classList.add('hidden');
  if (prefix === 'tc') tcInviteFilePreviewItems = []; else teInviteFilePreviewItems = [];
  if (!file) { statusEl.innerText = ''; return; }

  statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/training/parse-roster', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    if (prefix === 'tc') tcInviteFilePreviewItems = data.items; else teInviteFilePreviewItems = data.items;
    const foundCount = data.items.filter(it => it.found).length;
    statusEl.innerText = `✅ Đọc file "${data.fileName}": ${foundCount}/${data.items.length} tài khoản hợp lệ.`;
    previewBody.innerHTML = data.items.map(it => `<tr>
      <td class="p-1">${escapeHtml(it.username)}</td>
      <td class="p-1">${escapeHtml(it.name || '')}</td>
      <td class="p-1">${it.found ? (it.active === false ? '<span class="text-amber-600">⚠️ Tài khoản đã khoá</span>' : '<span class="text-emerald-600">✅ Hợp lệ</span>') : '<span class="text-red-600">⛔ Không tìm thấy</span>'}</td>
    </tr>`).join('');
    previewWrap.classList.remove('hidden');
    if (foundCount > 0) addBtn.classList.remove('hidden');
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
    event.target.value = '';
  }
}

function addTrainingInviteFileFound(prefix) {
  const items = prefix === 'tc' ? tcInviteFilePreviewItems : teInviteFilePreviewItems;
  const staged = prefix === 'tc' ? tcInviteListStaged : teInviteListStaged;
  items.filter(it => it.found && it.active !== false).forEach(it => {
    if (!staged.some(p => p.username === it.username)) staged.push({ username: it.username, name: it.name || it.username, dept: it.dept || '' });
  });
  if (prefix === 'tc') renderTrainingInviteListStagedList(); else renderTrainingEditInviteListStagedList();
  document.getElementById(`${prefix}InviteFileInput`).value = '';
  document.getElementById(`${prefix}InviteFilePreviewWrap`).classList.add('hidden');
  document.getElementById(`${prefix}InviteFileAddBtn`).classList.add('hidden');
  document.getElementById(`${prefix}InviteFileStatus`).innerText = '';
}

// Xuất Excel — tái dùng downloadXlsxFromServer()/POST /api/admin/export-xlsx đã có sẵn (không phân
// biệt module gọi, chỉ nhận {fileName, sheetName, columns, rows} rồi trả file .xlsx), dữ liệu lấy thẳng
// từ danh sách tạm đang có trên form — không cần route riêng nào cho việc xuất này.
function exportTrainingInviteList(prefix) {
  const staged = prefix === 'tc' ? tcInviteListStaged : teInviteListStaged;
  if (!staged.length) return alert('Danh sách được mời đang trống — chưa có gì để xuất.');
  const columns = [
    { header: 'Tài Khoản Đăng Nhập', key: 'username', width: 20 },
    { header: 'Họ Tên', key: 'name', width: 26 },
    { header: 'Phòng Ban', key: 'dept', width: 22 }
  ];
  downloadXlsxFromServer('DanhSachDuocMoi.xlsx', 'Danh Sách Được Mời', columns, staged);
}

function openEditTrainingClassModal(classId) {
  const c = DB.trainingClasses.find(x => x.id === classId);
  if (!c) return;
  if (!canManageTrainingClassLocal(currentUser, c)) return alert('⛔ Bạn không có quyền sửa lớp học này!');

  document.getElementById('teClassId').value = c.id;
  const catOpts = (DB.trainingCategories || []).map(cat => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`).join('');
  document.getElementById('teCategory').innerHTML = catOpts;
  document.getElementById('teCategory').value = c.category || '';
  document.getElementById('teTitle').value = c.title || '';
  // Kiểu Lớp Học đã CỐ ĐỊNH từ lúc tạo (không có ô đổi ở đây, xem chú thích đầu modal) — chỉ cần ẩn/hiện
  // theo đúng c.mode hiện có, không cần onchange nào cả (khác form Tạo Mới có #tcMode sống).
  const teIsOnline = c.mode === 'ONLINE';
  document.getElementById('teInstructorFieldWrap').classList.toggle('hidden', teIsOnline);
  document.getElementById('teLocationFieldWrap').classList.toggle('hidden', teIsOnline);
  populateSystemUsersDatalist();
  const instructorUser = c.instructorUsername ? DB.users.find(u => u.username === c.instructorUsername) : null;
  document.getElementById('teInstructor').value = instructorUser
    ? `${instructorUser.name} — ${instructorUser.dept || 'Chưa rõ phòng'} (${instructorUser.username})`
    : (c.instructor || '');
  document.getElementById('teInstructorUsername').value = c.instructorUsername || '';
  document.getElementById('teStart').value = c.startTime || '';
  document.getElementById('teEnd').value = c.endTime || '';
  document.getElementById('teLocation').value = c.location || '';
  document.getElementById('teDeadline').value = c.registerDeadline || '';
  document.getElementById('teCapacity').value = c.capacity || '';
  document.getElementById('tePassScore').value = c.passScore != null ? c.passScore : '';
  const testOpts = DB.trainingTests.slice().sort((a, b) => b.id - a.id)
    .map(t => `<option value="${t.id}">${escapeHtml(t.title)} (${t.questions.length} câu)</option>`).join('');
  document.getElementById('teTestId').innerHTML = `<option value="">-- Không gán bài test --</option>` + testOpts;
  document.getElementById('teTestId').value = c.testId != null ? String(c.testId) : '';
  document.getElementById('teTestSecondsPerQuestion').value = c.testSecondsPerQuestion || 120;
  const courseOpts = DB.trainingCourses.slice().sort((a, b) => b.id - a.id)
    .map(co => `<option value="${co.id}">${escapeHtml(co.name)} (${escapeHtml(co.category)})</option>`).join('');
  document.getElementById('teCourseId').innerHTML = `<option value="">-- Không thuộc chương trình nào --</option>` + courseOpts;
  document.getElementById('teCourseId').value = c.courseId != null ? String(c.courseId) : '';
  const docOpts = DB.trainingDocuments.slice().sort((a, b) => b.id - a.id)
    .map(d => `<option value="${d.id}">${escapeHtml(d.category)} — ${escapeHtml(d.title)}</option>`).join('');
  const teDoc = document.getElementById('teDocumentIds');
  teDoc.innerHTML = docOpts;
  const selectedDocIds = new Set(c.documentIds || []);
  [...teDoc.options].forEach(o => { o.selected = selectedDocIds.has(Number(o.value)); });
  document.getElementById('teDescription').value = c.description || '';
  teInviteListStaged = (Array.isArray(c.inviteList) ? c.inviteList : []).map(username => {
    const u = DB.users.find(x => x.username === username);
    return { username, name: u ? u.name : username, dept: u ? u.dept : '' };
  });
  renderTrainingEditInviteListStagedList();
  teInviteFilePreviewItems = [];
  document.getElementById('teInviteFileInput').value = '';
  document.getElementById('teInviteFileStatus').innerText = '';
  document.getElementById('teInviteFilePreviewWrap').classList.add('hidden');
  document.getElementById('teInviteFileAddBtn').classList.add('hidden');
  document.getElementById('trainingEditClassModal').classList.remove('hidden');
}
function closeEditTrainingClassModal() {
  document.getElementById('trainingEditClassModal').classList.add('hidden');
}

async function submitEditTrainingClass(e) {
  e.preventDefault();
  const classId = Number(document.getElementById('teClassId').value);
  const instructorText = document.getElementById('teInstructor').value.trim();
  const instructorUsername = document.getElementById('teInstructorUsername').value;
  if (instructorText && !instructorUsername) {
    return alert('Vui lòng chọn đúng giảng viên từ danh sách gợi ý (gõ tên hoặc tài khoản để tìm), hoặc để trống nếu chưa gán!');
  }
  const documentIds = [...document.getElementById('teDocumentIds').selectedOptions].map(o => Number(o.value));
  const payload = {
    category: document.getElementById('teCategory').value,
    title: document.getElementById('teTitle').value.trim(),
    instructor: instructorText,
    instructorUsername,
    startTime: document.getElementById('teStart').value,
    endTime: document.getElementById('teEnd').value,
    location: document.getElementById('teLocation').value.trim(),
    registerDeadline: document.getElementById('teDeadline').value,
    capacity: document.getElementById('teCapacity').value,
    passScore: document.getElementById('tePassScore').value,
    testId: document.getElementById('teTestId').value,
    testSecondsPerQuestion: document.getElementById('teTestSecondsPerQuestion').value,
    documentIds,
    description: document.getElementById('teDescription').value.trim(),
    inviteList: teInviteListStaged.map(p => p.username),
    courseId: document.getElementById('teCourseId').value
  };
  if (payload.testId) {
    const ps = Number(payload.passScore);
    if (payload.passScore === '' || !Number.isFinite(ps) || ps <= 0 || ps > 100) {
      return alert('⛔ Lớp có gán Bài Test cần nhập Điểm Đạt Yêu Cầu hợp lệ (1-100)!');
    }
  }
  let updated;
  try {
    const result = await callRecordAction('trainingClasses', classId, 'edit', payload);
    updated = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.trainingClasses.findIndex(x => x.id === classId);
  if (idx !== -1) DB.trainingClasses[idx] = updated;
  logSystemAction('INTERNAL', 'EDIT_TRAINING_CLASS', `Sửa lớp học [${updated.code} - ${updated.title}]`, 'SUCCESS', updated.code);
  alert('✅ Đã lưu thay đổi lớp học!');
  closeEditTrainingClassModal();
  renderTrainingLms();
}

async function registerForTrainingClass(classId) {
  const cls = DB.trainingClasses.find(c => c.id === classId);
  if (!cls) return;
  let newReg;
  try {
    const result = await callCreateAction('trainingRegistrations', {
      code: `DK-LOP-${classId}-${currentUser.username}-${Date.now()}`,
      classId, registeredAt: new Date().toLocaleString('vi-VN')
    });
    newReg = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  DB.trainingRegistrations.unshift(newReg);
  logSystemAction('INTERNAL', 'REGISTER_TRAINING_CLASS', `Đăng ký lớp học [${cls.code} - ${cls.title}]`, 'SUCCESS', cls.code);
  alert('✅ Đã đăng ký lớp học thành công!');
  renderTrainingClasses();
  renderTrainingMyRegs();
}

function deleteTrainingClass(id) {
  if (!confirm('Xóa lớp học này? Lịch sử đăng ký/kết quả liên quan vẫn được giữ lại.')) return;
  callRecordAction('trainingClasses', id, 'delete', {}).then(() => {
    DB.trainingClasses = DB.trainingClasses.filter(c => c.id !== id);
    logSystemAction('INTERNAL', 'DELETE_TRAINING_CLASS', `Xóa lớp học [id ${id}]`, 'SUCCESS');
    renderTrainingClasses();
    populateTrainingClassMultiSelects();
  }).catch(err => alert(`⛔ ${err.message}`));
}

// ---------- CHƯƠNG TRÌNH (trainingCourses, Đợt 4) ----------
// Catalog dùng chung, quản lý (tạo/xoá) CHỈ trainingManage (xem canManageTrainingLocal() +
// createValidation.js) — trainingClasses/trainingDocuments chỉ ĐỌC danh sách này qua
// populateTrainingCourseSelects() khi tạo/sửa của riêng chúng.
async function submitTrainingCourse(e) {
  e.preventDefault();
  if (!canManageTrainingLocal(currentUser)) return alert('⛔ Bạn không có quyền tạo chương trình đào tạo!');
  const category = document.getElementById('tccCategory').value;
  if (!category) return alert('Vui lòng chọn Loại Đào Tạo (thêm ở Quản Trị &gt; Quản Lý Danh Mục nếu chưa có)!');
  const payload = {
    code: `CT-${Date.now()}`,
    name: document.getElementById('tccName').value.trim(),
    category,
    description: document.getElementById('tccDescription').value.trim()
  };
  let newCourse;
  try {
    const result = await callCreateAction('trainingCourses', payload);
    newCourse = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  DB.trainingCourses.unshift(newCourse);
  logSystemAction('INTERNAL', 'CREATE_TRAINING_COURSE', `Tạo chương trình đào tạo [${newCourse.name}]`, 'SUCCESS', newCourse.code);
  alert('✅ Đã tạo chương trình thành công!');
  e.target.reset();
  renderTrainingLms();
}

function renderTrainingCourses() {
  const tbody = document.getElementById('trainingCoursesTableBody');
  if (!tbody) return;
  const list = DB.trainingCourses.slice().sort((a, b) => b.id - a.id);

  document.getElementById('paginationContainer_trainingCourses').innerHTML = buildPaginationBoxHTML('trainingCourses', 'renderTrainingCourses');
  const pageItems = paginateList('trainingCourses', list, 'renderTrainingCourses', 'chương trình');

  if (!pageItems.length) { tbody.innerHTML = `<tr><td colspan="4" class="text-center p-4 text-gray-400 italic">Chưa có chương trình nào.</td></tr>`; return; }
  tbody.innerHTML = pageItems.map(c => `
    <tr class="hover:bg-gray-50">
      <td class="border p-2 font-bold text-gray-800">${escapeHtml(c.name)}</td>
      <td class="border p-2">${escapeHtml(c.category)}</td>
      <td class="border p-2 text-gray-600">${escapeHtml(c.description || '')}</td>
      <td class="border p-2 text-center">${currentUser.perms?.admin ? `<button data-op="deleteTrainingCourse" data-arg0="${c.id}" class="text-red-500 font-bold hover:underline text-xs">Xóa</button>` : ''}</td>
    </tr>`).join('');
}

function deleteTrainingCourse(id) {
  if (!confirm('Xóa chương trình này? Lớp học/tài liệu đã gắn chương trình này vẫn được giữ lại (chỉ mất dòng hiển thị "Chương trình:").')) return;
  callRecordAction('trainingCourses', id, 'delete', {}).then(() => {
    DB.trainingCourses = DB.trainingCourses.filter(c => c.id !== id);
    logSystemAction('INTERNAL', 'DELETE_TRAINING_COURSE', `Xóa chương trình đào tạo [id ${id}]`, 'SUCCESS');
    renderTrainingCourses();
    populateTrainingCourseSelects();
  }).catch(err => alert(`⛔ ${err.message}`));
}

// ---------- KẾ HOẠCH ĐÀO TẠO (trainingPlans, Đợt 5) ----------
// Quản lý (lập/sửa) CHỈ trainingManage (cùng gác quyền như Chương Trình ở trên) — XOÁ chỉ Admin (cùng
// khuôn "xóa = quyền tối cao" của mọi collection Đào Tạo khác, xem deleteTrainingCourse() ở trên).
let editingTrainingPlanId = null;
async function submitTrainingPlan(e) {
  e.preventDefault();
  if (!canManageTrainingLocal(currentUser)) return alert('⛔ Bạn không có quyền lập kế hoạch đào tạo!');
  const month = document.getElementById('tpMonth').value;
  if (!month) return alert('Vui lòng chọn Tháng!');
  const payload = {
    month,
    courseId: document.getElementById('tpCourseId').value || null,
    targetDept: document.getElementById('tpTargetDept').value || '',
    audience: document.getElementById('tpAudience').value.trim(),
    plannedClasses: document.getElementById('tpPlannedClasses').value,
    plannedTrainees: document.getElementById('tpPlannedTrainees').value,
    plannedHours: document.getElementById('tpPlannedHours').value
  };
  let saved;
  try {
    if (editingTrainingPlanId) {
      const result = await callRecordAction('trainingPlans', editingTrainingPlanId, 'edit', payload);
      saved = result.item;
    } else {
      const result = await callCreateAction('trainingPlans', payload);
      saved = result.item;
    }
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.trainingPlans.findIndex(p => p.id === saved.id);
  if (idx !== -1) DB.trainingPlans[idx] = saved; else DB.trainingPlans.unshift(saved);
  const wasEditing = !!editingTrainingPlanId;
  logSystemAction('INTERNAL', wasEditing ? 'EDIT_TRAINING_PLAN' : 'CREATE_TRAINING_PLAN', `${wasEditing ? 'Sửa' : 'Lập'} kế hoạch đào tạo tháng [${saved.month}]`, 'SUCCESS', String(saved.id));
  alert(wasEditing ? '✅ Đã cập nhật kế hoạch đào tạo!' : '✅ Đã lập kế hoạch đào tạo thành công!');
  cancelEditTrainingPlan();
  renderTrainingLms();
}
function cancelEditTrainingPlan() {
  editingTrainingPlanId = null;
  document.getElementById('tpCancelEditBtn').classList.add('hidden');
  document.getElementById('tpSubmitBtn').innerText = 'Lập Kế Hoạch';
  document.getElementById('trainingPlanFormTitle').innerText = '➕ Lập Kế Hoạch Đào Tạo Mới';
  document.getElementById('trainingPlanForm').reset();
}
function openEditTrainingPlan(id) {
  const plan = DB.trainingPlans.find(p => p.id === id);
  if (!plan) return;
  editingTrainingPlanId = id;
  document.getElementById('tpMonth').value = plan.month || '';
  document.getElementById('tpCourseId').value = plan.courseId != null ? String(plan.courseId) : '';
  document.getElementById('tpTargetDept').value = plan.targetDept || '';
  document.getElementById('tpAudience').value = plan.audience || '';
  document.getElementById('tpPlannedClasses').value = plan.plannedClasses || 0;
  document.getElementById('tpPlannedTrainees').value = plan.plannedTrainees || 0;
  document.getElementById('tpPlannedHours').value = plan.plannedHours || 0;
  document.getElementById('tpCancelEditBtn').classList.remove('hidden');
  document.getElementById('tpSubmitBtn').innerText = 'Lưu Thay Đổi';
  document.getElementById('trainingPlanFormTitle').innerText = `✏️ Sửa Kế Hoạch — Tháng ${plan.month}`;
  document.getElementById('trainingPlanForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function deleteTrainingPlanAction(id) {
  if (!confirm('Xóa kế hoạch đào tạo này?')) return;
  callRecordAction('trainingPlans', id, 'delete', {}).then(() => {
    DB.trainingPlans = DB.trainingPlans.filter(p => p.id !== id);
    logSystemAction('INTERNAL', 'DELETE_TRAINING_PLAN', `Xóa kế hoạch đào tạo [id ${id}]`, 'SUCCESS');
    renderTrainingLms();
  }).catch(err => alert(`⛔ ${err.message}`));
}

function renderTrainingPlans() {
  const tbody = document.getElementById('trainingPlansTableBody');
  if (!tbody) return;
  const list = DB.trainingPlans.slice().sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || b.id - a.id);

  document.getElementById('paginationContainer_trainingPlans').innerHTML = buildPaginationBoxHTML('trainingPlans', 'renderTrainingPlans');
  const pageItems = paginateList('trainingPlans', list, 'renderTrainingPlans', 'kế hoạch');

  if (!pageItems.length) { tbody.innerHTML = `<tr><td colspan="9" class="text-center p-4 text-gray-400 italic">Chưa có kế hoạch đào tạo nào.</td></tr>`; return; }
  const canManage = canManageTrainingLocal(currentUser);
  tbody.innerHTML = pageItems.map(p => {
    const course = p.courseId != null ? DB.trainingCourses.find(c => c.id === p.courseId) : null;
    const pct = getTrainingPlanCompletionPct(p);
    const overdue = isTrainingPlanOverdue(p);
    return `
    <tr class="hover:bg-gray-50">
      <td class="border p-2 font-bold text-gray-800">${escapeHtml(p.month)}${overdue ? ' <span class="text-red-600 text-[10px] font-bold">⚠️ Quá hạn</span>' : ''}</td>
      <td class="border p-2">${course ? escapeHtml(course.name) : '<span class="text-gray-400 italic">—</span>'}</td>
      <td class="border p-2">${escapeHtml(p.targetDept || '')}</td>
      <td class="border p-2">${escapeHtml(p.audience || '')}</td>
      <td class="border p-2 text-center">${p.plannedClasses || 0}</td>
      <td class="border p-2 text-center">${p.plannedTrainees || 0}</td>
      <td class="border p-2 text-center">${p.plannedHours || 0}</td>
      <td class="border p-2 text-center">${pct == null ? '<span class="text-gray-400 italic">—</span>' : `${pct}%`}</td>
      <td class="border p-2 text-center space-x-2">
        ${canManage ? `<button data-op="openEditTrainingPlan" data-arg0="${p.id}" class="text-blue-600 font-bold hover:underline text-xs">Sửa</button>` : ''}
        ${currentUser.perms?.admin ? `<button data-op="deleteTrainingPlanAction" data-arg0="${p.id}" class="text-red-500 font-bold hover:underline text-xs">Xóa</button>` : ''}
      </td>
    </tr>`;
  }).join('');
}

// ---------- Kế Hoạch Đào Tạo: đối chiếu KẾ HOẠCH với số THẬT (Đợt 5) ----------
// Số thực tế KHÔNG lưu ở đâu cả — tính SỐNG từ DB.trainingClasses/DB.trainingRegistrations mỗi lần xem,
// cùng tinh thần "không lưu cái tính được" đã áp dụng cho sessionState/pinExpiresAt... trong app. "Đơn
// vị" của kế hoạch (targetDept) đối chiếu với trainingRegistrations.dept (dept của NGƯỜI ĐĂNG KÝ, tự
// động gán đúng phòng ban thật của họ lúc đăng ký — forceOwnDept, xem createValidation.js) — CỐ TÌNH
// KHÔNG đối chiếu với trainingClasses.dept (chỉ là phòng ban của người TẠO lớp, không phải "đơn vị lớp
// học phục vụ", xem baseline/ghi chú đầu module).
function trainingPlanMonthRange(month) {
  const parts = String(month || '').split('-').map(Number);
  const y = parts[0], m = parts[1];
  if (!y || !m) return { start: NaN, end: NaN };
  return { start: new Date(y, m - 1, 1).getTime(), end: new Date(y, m, 1).getTime() };
}
function trainingClassDurationHours(cls) {
  if (!cls.startTime || !cls.endTime) return 0;
  const ms = new Date(cls.endTime).getTime() - new Date(cls.startTime).getTime();
  return ms > 0 ? ms / 3600000 : 0;
}
// Lớp học THẬT tính vào 1 kế hoạch — cùng THÁNG bắt đầu; nếu kế hoạch có gắn Chương Trình thì lớp cũng
// phải cùng courseId, không gắn thì tính MỌI lớp phát sinh trong tháng đó (không lọc theo đơn vị ở bước
// này — trainingClasses không có khái niệm "đơn vị lớp phục vụ", lọc theo đơn vị chỉ áp dụng ở bước đăng
// ký bên dưới).
function getClassesForTrainingPlan(plan) {
  const { start, end } = trainingPlanMonthRange(plan.month);
  if (!Number.isFinite(start)) return [];
  return DB.trainingClasses.filter(c => {
    if (!c.startTime) return false;
    const t = new Date(c.startTime).getTime();
    if (!(t >= start && t < end)) return false;
    if (plan.courseId != null && c.courseId !== plan.courseId) return false;
    return true;
  });
}
function getTrainingPlanActualStats(plan) {
  const classes = getClassesForTrainingPlan(plan);
  const classIds = new Set(classes.map(c => c.id));
  let regs = DB.trainingRegistrations.filter(r => classIds.has(r.classId) && r.result !== 'CANCELLED');
  if (plan.targetDept) regs = regs.filter(r => r.dept === plan.targetDept);
  const actualClasses = classes.length;
  const actualTrainees = new Set(regs.map(r => r.creator)).size; // distinct học viên, không đếm theo dòng đăng ký
  const actualHours = classes.reduce((sum, c) => sum + trainingClassDurationHours(c), 0);
  return { classes, regs, actualClasses, actualTrainees, actualHours };
}
// % hoàn thành = trung bình 3 chiều (số lớp/số học viên/giờ), mỗi chiều chặn trần 100% (vượt kế hoạch ở
// 1 chiều không kéo % chung lên bất thường) — null nếu kế hoạch không đặt số nào cả (không có gì đối chiếu).
function getTrainingPlanCompletionPct(plan) {
  const stats = getTrainingPlanActualStats(plan);
  const ratios = [];
  if (plan.plannedClasses > 0) ratios.push(Math.min(stats.actualClasses / plan.plannedClasses, 1));
  if (plan.plannedTrainees > 0) ratios.push(Math.min(stats.actualTrainees / plan.plannedTrainees, 1));
  if (plan.plannedHours > 0) ratios.push(Math.min(stats.actualHours / plan.plannedHours, 1));
  if (!ratios.length) return null;
  return Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100);
}
// "Quá hạn/chưa thực hiện" — tính SỐNG theo giờ hệ thống: tháng kế hoạch đã trôi qua HẲN (đã sang tháng
// sau) và số thật còn thiếu so với kế hoạch (lớp hoặc học viên).
function isTrainingPlanOverdue(plan) {
  const { end } = trainingPlanMonthRange(plan.month);
  if (!Number.isFinite(end) || Date.now() < end) return false;
  const stats = getTrainingPlanActualStats(plan);
  return stats.actualClasses < (plan.plannedClasses || 0) || stats.actualTrainees < (plan.plannedTrainees || 0);
}

// Tổng hợp Dashboard theo bộ lọc (tháng/chương trình/đơn vị/đối tượng) — dùng CHUNG cho cả khối "Theo
// Dõi Thực Hiện" (drill vào đúng 1 tháng) LẪN "Dashboard" tổng quan (để trống tháng = mọi tháng đã lập kế
// hoạch), vì cả 2 chỉ khác nhau ở phạm vi lọc, không khác cách tính.
function computeTrainingPlanDashboard(filters) {
  let plans = DB.trainingPlans.slice();
  if (filters.month) plans = plans.filter(p => p.month === filters.month);
  if (filters.courseId) plans = plans.filter(p => p.courseId === filters.courseId);
  if (filters.targetDept) plans = plans.filter(p => p.targetDept === filters.targetDept);
  const audienceNeedle = (filters.audience || '').trim().toLowerCase();
  if (audienceNeedle) plans = plans.filter(p => (p.audience || '').toLowerCase().includes(audienceNeedle));

  let totalPlannedClasses = 0, totalPlannedTrainees = 0, totalPlannedHours = 0, totalActualClasses = 0, totalActualHours = 0;
  const distinctTrainees = new Set();
  const overdue = [];
  const byMonth = new Map(), byDept = new Map(), byCourse = new Map();
  const bump = (map, key, plan, stats) => {
    const row = map.get(key) || { key, plannedClasses: 0, plannedTrainees: 0, plannedHours: 0, actualClasses: 0, actualHours: 0, traineeSet: new Set() };
    row.plannedClasses += plan.plannedClasses || 0;
    row.plannedTrainees += plan.plannedTrainees || 0;
    row.plannedHours += plan.plannedHours || 0;
    row.actualClasses += stats.actualClasses;
    row.actualHours += stats.actualHours;
    stats.regs.forEach(r => row.traineeSet.add(r.creator));
    map.set(key, row);
  };

  plans.forEach(plan => {
    const stats = getTrainingPlanActualStats(plan);
    totalPlannedClasses += plan.plannedClasses || 0;
    totalPlannedTrainees += plan.plannedTrainees || 0;
    totalPlannedHours += plan.plannedHours || 0;
    totalActualClasses += stats.actualClasses;
    totalActualHours += stats.actualHours;
    stats.regs.forEach(r => distinctTrainees.add(r.creator));
    if (isTrainingPlanOverdue(plan)) overdue.push({ plan, stats });

    bump(byMonth, plan.month, plan, stats);
    bump(byDept, plan.targetDept || '(Chưa gán đơn vị)', plan, stats);
    const course = plan.courseId != null ? DB.trainingCourses.find(c => c.id === plan.courseId) : null;
    bump(byCourse, course ? course.name : '(Không gắn chương trình)', plan, stats);
  });

  const finalizeRows = (map) => [...map.values()]
    .map(r => ({ ...r, actualTrainees: r.traineeSet.size }))
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));

  const ratios = [];
  if (totalPlannedClasses > 0) ratios.push(Math.min(totalActualClasses / totalPlannedClasses, 1));
  if (totalPlannedTrainees > 0) ratios.push(Math.min(distinctTrainees.size / totalPlannedTrainees, 1));
  if (totalPlannedHours > 0) ratios.push(Math.min(totalActualHours / totalPlannedHours, 1));
  const pct = ratios.length ? Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100) : null;

  return {
    plans, totalPlannedClasses, totalPlannedTrainees, totalPlannedHours,
    totalActualClasses, totalActualTrainees: distinctTrainees.size, totalActualHours,
    pct, overdue,
    byMonth: finalizeRows(byMonth), byDept: finalizeRows(byDept), byCourse: finalizeRows(byCourse)
  };
}

let currentTrainingPlanDashboardData = null;
function renderTrainingPlanDashboard() {
  const wrap = document.getElementById('tpDashResultWrap');
  if (!wrap) return;
  const filters = {
    month: document.getElementById('tpDashMonth')?.value || '',
    courseId: Number(document.getElementById('tpDashCourseId')?.value) || null,
    targetDept: document.getElementById('tpDashTargetDept')?.value || '',
    audience: document.getElementById('tpDashAudience')?.value || ''
  };
  const data = computeTrainingPlanDashboard(filters);
  currentTrainingPlanDashboardData = data;

  const fmtHours = (h) => (Math.round(h * 10) / 10).toLocaleString('vi-VN');
  const breakdownTable = (title, rows, keyLabel) => `
    <div class="mt-3">
      <h4 class="font-bold text-xs text-gray-700 mb-1">${escapeHtml(title)}</h4>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-xs bg-white">
          <thead><tr class="bg-gray-100 text-left">
            <th class="border p-1.5">${escapeHtml(keyLabel)}</th>
            <th class="border p-1.5 text-center">Số Lớp (TT/KH)</th>
            <th class="border p-1.5 text-center">Học Viên (TT/KH)</th>
            <th class="border p-1.5 text-center">Giờ (TT/KH)</th>
          </tr></thead>
          <tbody>${rows.length ? rows.map(r => `
            <tr>
              <td class="border p-1.5">${escapeHtml(String(r.key))}</td>
              <td class="border p-1.5 text-center">${r.actualClasses}/${r.plannedClasses}</td>
              <td class="border p-1.5 text-center">${r.actualTrainees}/${r.plannedTrainees}</td>
              <td class="border p-1.5 text-center">${fmtHours(r.actualHours)}/${fmtHours(r.plannedHours)}</td>
            </tr>`).join('') : `<tr><td colspan="4" class="text-center p-2 text-gray-400 italic">Không có dữ liệu.</td></tr>`}</tbody>
        </table>
      </div>
    </div>`;

  const overdueRows = data.overdue.map(({ plan, stats }) => {
    const course = plan.courseId != null ? DB.trainingCourses.find(c => c.id === plan.courseId) : null;
    return `<tr>
      <td class="border p-1.5">${escapeHtml(plan.month)}</td>
      <td class="border p-1.5">${course ? escapeHtml(course.name) : '<span class="text-gray-400 italic">—</span>'}</td>
      <td class="border p-1.5">${escapeHtml(plan.targetDept || '')}</td>
      <td class="border p-1.5 text-center">${stats.actualClasses}/${plan.plannedClasses || 0}</td>
      <td class="border p-1.5 text-center">${stats.actualTrainees}/${plan.plannedTrainees || 0}</td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <div class="grid grid-cols-2 md:grid-cols-3 gap-3 text-center">
      <div class="bg-white border border-emerald-200 rounded p-3"><div class="text-xs text-gray-600">Số Lớp (Thực Tế/Kế Hoạch)</div><div class="font-bold text-lg text-emerald-800">${data.totalActualClasses}/${data.totalPlannedClasses}</div></div>
      <div class="bg-white border border-emerald-200 rounded p-3"><div class="text-xs text-gray-600">CBNV Được Đào Tạo (Thực Tế/Kế Hoạch)</div><div class="font-bold text-lg text-emerald-800">${data.totalActualTrainees}/${data.totalPlannedTrainees}</div></div>
      <div class="bg-white border border-emerald-200 rounded p-3"><div class="text-xs text-gray-600">Giờ Đào Tạo (Thực Tế/Kế Hoạch)</div><div class="font-bold text-lg text-emerald-800">${fmtHours(data.totalActualHours)}/${fmtHours(data.totalPlannedHours)}</div></div>
      <div class="bg-white border border-violet-200 rounded p-3"><div class="text-xs text-gray-600">Tỷ Lệ Hoàn Thành</div><div class="font-bold text-lg text-violet-800">${data.pct == null ? '—' : data.pct + '%'}</div></div>
      <div class="bg-white border border-amber-200 rounded p-3"><div class="text-xs text-gray-600">Kế Hoạch Quá Hạn/Chưa Thực Hiện</div><div class="font-bold text-lg text-amber-700">${data.overdue.length}</div></div>
      <div class="bg-white border border-gray-200 rounded p-3"><div class="text-xs text-gray-600">Số Kế Hoạch Đang Xem</div><div class="font-bold text-lg text-gray-700">${data.plans.length}</div></div>
    </div>
    ${breakdownTable('Theo Tháng', data.byMonth, 'Tháng')}
    ${breakdownTable('Theo Đơn Vị', data.byDept, 'Đơn Vị')}
    ${breakdownTable('Theo Chương Trình', data.byCourse, 'Chương Trình')}
    <div class="mt-3">
      <h4 class="font-bold text-xs text-gray-700 mb-1">⚠️ Quá Hạn / Chưa Thực Hiện</h4>
      <div class="overflow-x-auto">
        <table class="w-full border-collapse text-xs bg-white">
          <thead><tr class="bg-amber-50 text-left"><th class="border p-1.5">Tháng</th><th class="border p-1.5">Chương Trình</th><th class="border p-1.5">Đơn Vị</th><th class="border p-1.5 text-center">Số Lớp (TT/KH)</th><th class="border p-1.5 text-center">Học Viên (TT/KH)</th></tr></thead>
          <tbody>${overdueRows || `<tr><td colspan="5" class="text-center p-2 text-gray-400 italic">Không có kế hoạch nào quá hạn.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
    <div class="flex justify-end pt-2">
      <button data-op="exportTrainingPlanDashboardExcel" class="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-emerald-700">📊 Xuất Excel</button>
    </div>
  `;
}
function exportTrainingPlanDashboardExcel() {
  const data = currentTrainingPlanDashboardData;
  if (!data) return;
  const columns = [
    { header: 'Tháng', key: 'month', width: 12 },
    { header: 'Chương Trình', key: 'course', width: 28 },
    { header: 'Đơn Vị', key: 'dept', width: 20 },
    { header: 'Đối Tượng', key: 'audience', width: 20 },
    { header: 'Số Lớp KH', key: 'plannedClasses', width: 12 },
    { header: 'Số Lớp TT', key: 'actualClasses', width: 12 },
    { header: 'Học Viên KH', key: 'plannedTrainees', width: 12 },
    { header: 'Học Viên TT', key: 'actualTrainees', width: 12 },
    { header: 'Giờ KH', key: 'plannedHours', width: 10 },
    { header: 'Giờ TT', key: 'actualHours', width: 10 },
    { header: '% Hoàn Thành', key: 'pct', width: 12 }
  ];
  const rows = data.plans.map(plan => {
    const course = plan.courseId != null ? DB.trainingCourses.find(c => c.id === plan.courseId) : null;
    const stats = getTrainingPlanActualStats(plan);
    return {
      month: plan.month, course: course ? course.name : '', dept: plan.targetDept || '', audience: plan.audience || '',
      plannedClasses: plan.plannedClasses || 0, actualClasses: stats.actualClasses,
      plannedTrainees: plan.plannedTrainees || 0, actualTrainees: stats.actualTrainees,
      plannedHours: plan.plannedHours || 0, actualHours: Math.round(stats.actualHours * 10) / 10,
      pct: getTrainingPlanCompletionPct(plan) ?? ''
    };
  });
  downloadXlsxFromServer('theo_doi_ke_hoach_dao_tao.xlsx', 'Theo Dõi Kế Hoạch Đào Tạo', columns, rows);
}

// ---------- Nhập Kế Hoạch Từ Excel (theo tháng) ----------
// Cùng khuôn onTrainingRosterFileChange()/confirmTrainingRosterAdd() (roster) — parse-preview NGAY khi
// chọn file (server đối chiếu tên Chương Trình với DB.trainingCourses thật), rồi CONFIRM ở bước sau mới
// thật sự tạo — mỗi dòng đi qua ĐÚNG POST /api/create/trainingPlans (được kiểm tra lại đầy đủ), KHÔNG tin
// nguyên dữ liệu xem trước để ghi thẳng hàng loạt.
let trainingPlanImportPreviewItems = [];
async function onTrainingPlanImportFileChange(event) {
  const file = event.target.files[0];
  trainingPlanImportPreviewItems = [];
  document.getElementById('tpImportPreviewWrap').classList.add('hidden');
  document.getElementById('tpImportConfirmBtn').classList.add('hidden');
  const statusEl = document.getElementById('tpImportStatus');
  if (!file) { statusEl.innerText = ''; return; }

  statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/training/parse-plan-import', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    trainingPlanImportPreviewItems = data.items;
    const validCount = data.items.filter(it => it.monthValid).length;
    statusEl.innerText = `✅ Đọc file "${data.fileName}": ${validCount}/${data.items.length} dòng hợp lệ.`;
    document.getElementById('tpImportPreviewBody').innerHTML = data.items.map(it => `<tr>
      <td class="p-1">${escapeHtml(it.month)}</td>
      <td class="p-1">${escapeHtml(it.courseName || '')}${it.courseName ? (it.courseMatched ? ' <span class="text-emerald-600">✅ khớp</span>' : ' <span class="text-amber-600">⚠️ không khớp</span>') : ''}</td>
      <td class="p-1">${escapeHtml(it.targetDept || '')}</td>
      <td class="p-1">${escapeHtml(it.audience || '')}</td>
      <td class="p-1 text-center">${it.plannedClasses}</td>
      <td class="p-1 text-center">${it.plannedTrainees}</td>
      <td class="p-1 text-center">${it.plannedHours}</td>
      <td class="p-1">${it.monthValid ? '<span class="text-emerald-600">✅ Hợp lệ</span>' : '<span class="text-red-600">⛔ Tháng không hợp lệ</span>'}</td>
    </tr>`).join('');
    document.getElementById('tpImportPreviewWrap').classList.remove('hidden');
    if (validCount > 0) document.getElementById('tpImportConfirmBtn').classList.remove('hidden');
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
    event.target.value = '';
  }
}

async function confirmTrainingPlanImport() {
  const validItems = trainingPlanImportPreviewItems.filter(it => it.monthValid);
  if (!validItems.length) return alert('Không có dòng hợp lệ nào để nhập.');
  let successCount = 0;
  const failed = [];
  for (const it of validItems) {
    try {
      const result = await callCreateAction('trainingPlans', {
        month: it.month, courseId: it.courseId, targetDept: it.targetDept, audience: it.audience,
        plannedClasses: it.plannedClasses, plannedTrainees: it.plannedTrainees, plannedHours: it.plannedHours
      });
      DB.trainingPlans.unshift(result.item);
      successCount++;
    } catch (err) {
      failed.push({ month: it.month, error: err.message });
    }
  }
  logSystemAction('INTERNAL', 'IMPORT_TRAINING_PLAN', `Nhập ${successCount} dòng kế hoạch đào tạo từ Excel`, 'SUCCESS');
  let msg = `✅ Đã nhập ${successCount}/${validItems.length} dòng kế hoạch.`;
  if (failed.length) {
    msg += `\n\n⛔ ${failed.length} dòng lỗi:\n` + failed.map(f => `- Tháng ${f.month}: ${f.error}`).join('\n');
  }
  alert(msg);
  document.getElementById('tpImportFileInput').value = '';
  document.getElementById('tpImportPreviewWrap').classList.add('hidden');
  document.getElementById('tpImportConfirmBtn').classList.add('hidden');
  document.getElementById('tpImportStatus').innerText = '';
  trainingPlanImportPreviewItems = [];
  renderTrainingLms();
}

function openTrainingClassQrModal(classId) {
  const cls = DB.trainingClasses.find(c => c.id === classId);
  if (!cls) return;
  document.getElementById('trainingClassQrSubtitle').innerText = cls.title;
  document.getElementById('trainingClassQrImg').src = `/api/training/class-qr/${classId}`;
  document.getElementById('trainingClassQrModal').classList.remove('hidden');
}
function closeTrainingClassQrModal() { document.getElementById('trainingClassQrModal').classList.add('hidden'); }

// ---------- KẾT QUẢ HỌC VIÊN (modal) ----------
let trainingResultsModalClassId = null;
function openTrainingResultsModal(classId) {
  trainingResultsModalClassId = classId;
  const cls = DB.trainingClasses.find(c => c.id === classId);
  if (!cls) return;
  document.getElementById('trainingResultsModalTitle').innerText = `👥 Kết quả — ${cls.title}`;
  renderTrainingResultsModalBody();
  document.getElementById('trainingResultsModal').classList.remove('hidden');
}
function closeTrainingResultsModal() { document.getElementById('trainingResultsModal').classList.add('hidden'); }

function renderTrainingResultsModalBody() {
  const regs = DB.trainingRegistrations.filter(r => r.classId === trainingResultsModalClassId && r.result !== 'CANCELLED');
  const cls = DB.trainingClasses.find(c => c.id === trainingResultsModalClassId);
  const body = document.getElementById('trainingResultsModalBody');
  if (!regs.length) { body.innerHTML = `<tr><td colspan="6" class="text-center p-4 text-gray-400 italic">Chưa có ai đăng ký.</td></tr>`; return; }
  // Đợt 8 — lớp ĐÃ gán bài test không còn ô chấm tay nữa (server chặn hẳn set-result khi cls.testId !=
  // null, xem setTrainingRegistrationResult() ở lib/recordActions.js) — kết quả CHỈ đến từ học viên tự
  // làm bài (openTakeTestModal()/ttTakeSubmit()), hiển thị lại đúng trạng thái đã ghi nhận thay vì ô chọn.
  const hasTest = cls && cls.testId != null;
  body.innerHTML = regs.map(r => {
    const disp = getTrainingRegDisplayStatus(r, cls);
    const resultCell = hasTest
      ? `<span class="text-xs italic text-gray-500">🧪 Tự động qua bài test</span>`
      : `<select id="trResult_${r.id}" class="border rounded p-1">
          <option value="REGISTERED" ${r.result === 'REGISTERED' ? 'selected' : ''}>Đang học</option>
          <option value="PASSED" ${r.result === 'PASSED' ? 'selected' : ''}>✅ Đạt</option>
          <option value="FAILED" ${r.result === 'FAILED' ? 'selected' : ''}>❌ Không đạt</option>
        </select>`;
    const scoreCell = hasTest
      ? `${r.score != null ? escapeHtml(String(r.score)) + '%' : ''}`
      : `<input id="trScore_${r.id}" type="number" min="0" max="100" value="${r.score != null ? r.score : ''}" class="w-16 border rounded p-1">`;
    const actionCell = hasTest ? '' : `<button data-op="saveTrainingResult" data-arg0="${r.id}" class="bg-emerald-600 text-white px-2 py-1 rounded font-bold hover:bg-emerald-700">Lưu</button>`;
    // Đợt 9 — hiện yêu cầu huỷ đang chờ NGAY trong bảng này (KHÔNG cần mở riêng đâu khác) — chỉ
    // trainingManage/admin thấy nút Duyệt/Từ chối, trainingInstruct (nếu cũng quản lý được lớp này qua
    // canManageTrainingClassLocal()) chỉ thấy dòng chữ trạng thái, đúng quyết định "chỉ trainingManage/
    // admin duyệt" (xem approveCancelTrainingRegistration()/rejectCancelTrainingRegistration()).
    const canApproveCancel = currentUser.perms?.admin || currentUser.perms?.trainingManage;
    const cancelReqHTML = r.pendingCancellation
      ? (canApproveCancel
          ? `<div class="mt-1 bg-amber-50 border border-amber-200 rounded p-1.5 text-left">
               <div class="text-amber-700 font-bold text-xs">⏳ Yêu cầu huỷ${r.pendingCancellation.reason ? `: ${escapeHtml(r.pendingCancellation.reason)}` : ''}</div>
               <div class="flex gap-1 mt-1">
                 <button data-op="approveCancelTrainingRegAction" data-arg0="${r.id}" class="bg-emerald-600 text-white px-2 py-0.5 rounded text-xs font-bold hover:bg-emerald-700">Duyệt Huỷ</button>
                 <button data-op="rejectCancelTrainingRegAction" data-arg0="${r.id}" class="bg-gray-400 text-white px-2 py-0.5 rounded text-xs font-bold hover:bg-gray-500">Từ Chối</button>
               </div>
             </div>`
          : `<div class="mt-1 text-amber-600 text-xs italic">⏳ Đang chờ duyệt huỷ</div>`)
      : '';
    return `
    <tr>
      <td class="border p-2">${escapeHtml(r.creatorName)}<br><span class="text-gray-400">${escapeHtml(r.dept)}</span></td>
      <td class="border p-2">${escapeHtml(r.registeredAt || '')}</td>
      <td class="border p-2"><span class="text-xs font-semibold">${escapeHtml(disp.label)}${disp.sub ? ` (${escapeHtml(disp.sub)})` : ''}</span></td>
      <td class="border p-2">${resultCell}</td>
      <td class="border p-2">${scoreCell}</td>
      <td class="border p-2 text-center">${actionCell}${cancelReqHTML}</td>
    </tr>`;
  }).join('');
}

async function saveTrainingResult(regId) {
  const result = document.getElementById(`trResult_${regId}`).value;
  if (result === 'REGISTERED') return alert('Vui lòng chọn Đạt hoặc Không đạt để lưu kết quả.');
  const scoreRaw = document.getElementById(`trScore_${regId}`).value;
  let updated;
  try {
    const res = await callRecordAction('trainingRegistrations', regId, 'set-result', { result, score: scoreRaw === '' ? null : Number(scoreRaw) });
    updated = res.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.trainingRegistrations.findIndex(x => x.id === regId);
  if (idx !== -1) DB.trainingRegistrations[idx] = updated;
  logSystemAction('INTERNAL', 'SET_TRAINING_RESULT', `Ghi nhận kết quả [${updated.classCode}] cho ${updated.creatorName}: ${result === 'PASSED' ? 'Đạt' : 'Không đạt'}`, 'SUCCESS', updated.classCode);
  renderTrainingResultsModalBody();
  renderTrainingClasses();
  renderCareerPaths();
}

// Đợt 9 — Duyệt/Từ chối yêu cầu huỷ đăng ký lớp học (CHỈ trainingManage/admin, xem
// approveCancelTrainingRegistration()/rejectCancelTrainingRegistration(), lib/recordActions.js). Gọi
// được từ 2 nơi: bảng Kết Quả của TỪNG lớp (renderTrainingResultsModalBody()) và hộp tổng hợp mọi yêu
// cầu đang chờ ở đầu tab Lớp Học (renderTrainingCancelRequestsQueue()) — nên refresh cả 2 nơi sau khi
// xong, bất kể request đến từ đâu (an toàn, không tồn tại thì DOM query trả về null, không lỗi gì).
async function approveCancelTrainingRegAction(regId) {
  if (!confirm('Duyệt yêu cầu huỷ đăng ký này? Học viên sẽ bị huỷ khỏi lớp học.')) return;
  let updated;
  try {
    const res = await callRecordAction('trainingRegistrations', regId, 'approve-cancel', {});
    updated = res.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.trainingRegistrations.findIndex(x => x.id === regId);
  if (idx !== -1) DB.trainingRegistrations[idx] = updated;
  logSystemAction('INTERNAL', 'APPROVE_CANCEL_TRAINING_REG', `Duyệt huỷ đăng ký lớp học [${updated.classCode}] của ${updated.creatorName}`, 'SUCCESS', updated.classCode);
  renderTrainingResultsModalBody();
  renderTrainingCancelRequestsQueue();
  renderTrainingClasses();
}
async function rejectCancelTrainingRegAction(regId) {
  if (!confirm('Từ chối yêu cầu huỷ này? Học viên vẫn giữ nguyên đăng ký trong lớp.')) return;
  let updated;
  try {
    const res = await callRecordAction('trainingRegistrations', regId, 'reject-cancel', {});
    updated = res.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.trainingRegistrations.findIndex(x => x.id === regId);
  if (idx !== -1) DB.trainingRegistrations[idx] = updated;
  logSystemAction('INTERNAL', 'REJECT_CANCEL_TRAINING_REG', `Từ chối huỷ đăng ký lớp học [${updated.classCode}] của ${updated.creatorName}`, 'SUCCESS', updated.classCode);
  renderTrainingResultsModalBody();
  renderTrainingCancelRequestsQueue();
}

// Hộp tổng hợp mọi yêu cầu huỷ đang chờ, gộp từ TẤT CẢ các lớp (không cần mở từng modal Kết Quả để
// tìm) — chỉ trainingManage/admin thấy, ẩn hẳn khi không có yêu cầu nào đang chờ. Gọi từ
// renderTrainingClasses() nên luôn cùng nhịp với tab Lớp Học.
function renderTrainingCancelRequestsQueue() {
  const wrap = document.getElementById('trainingCancelRequestsWrap');
  const container = document.getElementById('trainingCancelRequestsContainer');
  if (!wrap || !container) return;
  if (!currentUser.perms?.admin && !currentUser.perms?.trainingManage) { wrap.classList.add('hidden'); return; }
  const pending = DB.trainingRegistrations.filter(r => r.pendingCancellation);
  wrap.classList.toggle('hidden', !pending.length);
  if (!pending.length) { container.innerHTML = ''; return; }
  container.innerHTML = pending.map(r => `
    <div class="bg-amber-50 border border-amber-200 rounded p-2 flex justify-between items-center gap-2 text-xs">
      <div>
        <b>${escapeHtml(r.creatorName)}</b> (${escapeHtml(r.dept || '')}) muốn huỷ lớp <b>${escapeHtml(r.className || '')}</b>${r.pendingCancellation.reason ? ` — Lý do: ${escapeHtml(r.pendingCancellation.reason)}` : ''}
        <div class="text-gray-400">Gửi lúc ${escapeHtml(r.pendingCancellation.requestedAt || '')}</div>
      </div>
      <div class="flex gap-1 flex-shrink-0">
        <button data-op="approveCancelTrainingRegAction" data-arg0="${r.id}" class="bg-emerald-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-emerald-700">Duyệt Huỷ</button>
        <button data-op="rejectCancelTrainingRegAction" data-arg0="${r.id}" class="bg-gray-400 text-white px-2 py-1 rounded text-xs font-bold hover:bg-gray-500">Từ Chối</button>
      </div>
    </div>`).join('');
}

// Xuất Excel kết quả đào tạo (Đợt 4) — cùng cơ chế chung downloadXlsxFromServer() (POST /api/admin/export-xlsx)
// đã dùng cho các màn xuất Excel khác trong app (vd exportBudgetSummaryExcel()), KHÔNG có route riêng.
// Chỉ những ai đã mở được modal Kết Quả (canManageTrainingClassLocal() — trainingManage hoặc đúng
// giảng viên được gán, xem renderTrainingClasses()) mới thấy được nút này, vì nó nằm trong modal đó.
async function exportTrainingResultsExcel() {
  const cls = DB.trainingClasses.find(c => c.id === trainingResultsModalClassId);
  if (!cls) return;
  const regs = DB.trainingRegistrations.filter(r => r.classId === trainingResultsModalClassId && r.result !== 'CANCELLED');
  const rows = regs.map(r => {
    const disp = getTrainingRegDisplayStatus(r, cls);
    return {
      hocVien: r.creatorName || '',
      phongBan: r.dept || '',
      trangThai: disp.label + (disp.sub ? ` (${disp.sub})` : ''),
      diem: r.score != null ? r.score : '',
      dangKyLuc: r.registeredAt || '',
      coKetQuaLuc: r.resultAt || ''
    };
  });
  await downloadXlsxFromServer(
    `KetQuaDaoTao_${cls.code || cls.id}.xlsx`,
    'Kết Quả Đào Tạo',
    [
      { header: 'Tên Học Viên', key: 'hocVien', width: 24 },
      { header: 'Phòng Ban', key: 'phongBan', width: 20 },
      { header: 'Trạng Thái', key: 'trangThai', width: 20 },
      { header: 'Điểm', key: 'diem', width: 10 },
      { header: 'Thời Gian Đăng Ký', key: 'dangKyLuc', width: 20 },
      { header: 'Thời Gian Có Kết Quả', key: 'coKetQuaLuc', width: 20 }
    ],
    rows
  );
}

// ---------- Thêm hàng loạt học viên vào lớp (Cách 1: tìm-chọn dropdown, Cách 2: mẫu Excel) ----------
let trainingRosterModalClassId = null;
let trainingRosterStaged = []; // [{ username, name, dept }] — danh sách tạm, chưa gửi lên server
let trainingRosterFilePreviewItems = []; // kết quả gần nhất từ /api/training/parse-roster

function openTrainingRosterModal(classId) {
  trainingRosterModalClassId = classId;
  const cls = DB.trainingClasses.find(c => c.id === classId);
  if (!cls) return;
  trainingRosterStaged = [];
  trainingRosterFilePreviewItems = [];
  document.getElementById('trainingRosterModalTitle').innerText = `➕ Thêm học viên — ${cls.title}`;
  document.getElementById('trRosterPickInput').value = '';
  document.getElementById('trRosterFileInput').value = '';
  document.getElementById('trRosterFileStatus').innerText = '';
  document.getElementById('trRosterFilePreviewWrap').classList.add('hidden');
  document.getElementById('trRosterFileAddBtn').classList.add('hidden');
  renderTrainingRosterStagedList();
  document.getElementById('trainingRosterModal').classList.remove('hidden');
}

function closeTrainingRosterModal() {
  document.getElementById('trainingRosterModal').classList.add('hidden');
}

// Thêm 1 người vào danh sách tạm — dùng chung cho cả 2 cách (tìm-chọn / từ file), chặn trùng username.
function stageTrainingRosterUser(username, name, dept) {
  if (!username || trainingRosterStaged.some(p => p.username === username)) return;
  trainingRosterStaged.push({ username, name: name || username, dept: dept || '' });
}

function renderTrainingRosterStagedList() {
  document.getElementById('trRosterStagedCount').innerText = trainingRosterStaged.length;
  const wrap = document.getElementById('trRosterStagedList');
  if (!trainingRosterStaged.length) {
    wrap.innerHTML = `<span class="text-gray-400 italic text-xs">Chưa chọn học viên nào.</span>`;
    return;
  }
  wrap.innerHTML = trainingRosterStaged.map(p => `
    <span class="inline-flex items-center gap-1 bg-teal-50 border border-teal-200 text-teal-800 rounded-full pl-2 pr-1 py-0.5 text-xs">
      ${escapeHtml(p.name)}${p.dept ? ` <span class="text-teal-500">(${escapeHtml(p.dept)})</span>` : ''}
      <button type="button" data-op="removeTrainingRosterStaged" data-arg0="${escapeHtml(p.username)}" class="text-teal-500 hover:text-red-600 font-bold leading-none px-1">&times;</button>
    </span>`).join('');
}

function removeTrainingRosterStaged(username) {
  trainingRosterStaged = trainingRosterStaged.filter(p => p.username !== username);
  renderTrainingRosterStagedList();
}

// Cách 1: gõ vào ô tìm kiếm rồi bấm Thêm/Enter — value khớp đúng định dạng datalist chung
// "Họ tên — Phòng ban (username)" (xem populateSystemUsersDatalist()).
function addTrainingRosterPick() {
  const input = document.getElementById('trRosterPickInput');
  const raw = input.value.trim();
  if (!raw) return;
  const m = raw.match(/^(.*) — .*\(([^()]+)\)$/);
  const user = m ? DB.users.find(u => u.username === m[2].trim()) : DB.users.find(u => u.username === raw);
  if (!user) return alert('Không tìm thấy tài khoản này trong danh sách gợi ý — vui lòng chọn đúng từ dropdown.');
  stageTrainingRosterUser(user.username, user.name, user.dept);
  renderTrainingRosterStagedList();
  input.value = '';
  input.focus();
}

// Cách 2: upload file mẫu đã điền — đọc + đối chiếu ngay với danh sách tài khoản hệ thống (server tự
// làm việc này ở /api/training/parse-roster), hiển thị xem trước ai hợp lệ/ai không tìm thấy.
async function onTrainingRosterFileChange(event) {
  const file = event.target.files[0];
  trainingRosterFilePreviewItems = [];
  document.getElementById('trRosterFilePreviewWrap').classList.add('hidden');
  document.getElementById('trRosterFileAddBtn').classList.add('hidden');
  const statusEl = document.getElementById('trRosterFileStatus');
  if (!file) { statusEl.innerText = ''; return; }

  statusEl.innerText = '⏳ Đang đọc file...';
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/api/training/parse-roster', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
    trainingRosterFilePreviewItems = data.items;
    const foundCount = data.items.filter(it => it.found).length;
    statusEl.innerText = `✅ Đọc file "${data.fileName}": ${foundCount}/${data.items.length} tài khoản hợp lệ.`;
    document.getElementById('trRosterFilePreviewBody').innerHTML = data.items.map(it => `<tr>
      <td class="p-1">${escapeHtml(it.username)}</td>
      <td class="p-1">${escapeHtml(it.name || '')}</td>
      <td class="p-1">${it.found ? (it.active === false ? '<span class="text-amber-600">⚠️ Tài khoản đã khoá</span>' : '<span class="text-emerald-600">✅ Hợp lệ</span>') : '<span class="text-red-600">⛔ Không tìm thấy</span>'}</td>
    </tr>`).join('');
    document.getElementById('trRosterFilePreviewWrap').classList.remove('hidden');
    if (foundCount > 0) document.getElementById('trRosterFileAddBtn').classList.remove('hidden');
  } catch (err) {
    statusEl.innerText = `⛔ ${err.message}`;
    event.target.value = '';
  }
}

function addTrainingRosterFileFound() {
  trainingRosterFilePreviewItems.filter(it => it.found && it.active !== false)
    .forEach(it => stageTrainingRosterUser(it.username, it.name, it.dept));
  renderTrainingRosterStagedList();
}

const TRAINING_ROSTER_SKIP_REASON_LABELS = {
  NOT_FOUND: 'Không tìm thấy tài khoản / tài khoản đã khoá',
  ALREADY_REGISTERED: 'Đã đăng ký lớp này rồi',
  CAPACITY_FULL: 'Lớp đã đủ số lượng'
};

async function confirmTrainingRosterAdd() {
  if (!trainingRosterStaged.length) return alert('Vui lòng chọn ít nhất 1 học viên trước khi xác nhận.');
  const classId = trainingRosterModalClassId;
  const cls = DB.trainingClasses.find(c => c.id === classId);
  let result;
  try {
    result = await callRecordAction('trainingClasses', classId, 'bulk-register', { usernames: trainingRosterStaged.map(p => p.username) });
  } catch (err) { return alert(`⛔ ${err.message}`); }

  (result.added || []).forEach(reg => DB.trainingRegistrations.unshift(reg));
  logSystemAction('INTERNAL', 'BULK_REGISTER_TRAINING_CLASS', `Thêm ${result.added.length} học viên vào lớp [${cls ? cls.code : classId}]`, 'SUCCESS', cls ? cls.code : '');

  let msg = `✅ Đã thêm ${result.added.length}/${trainingRosterStaged.length} học viên vào lớp.`;
  if (result.skipped && result.skipped.length) {
    msg += `\n\n⛔ ${result.skipped.length} người bị bỏ qua:\n` +
      result.skipped.map(s => `- ${s.name || s.username}: ${TRAINING_ROSTER_SKIP_REASON_LABELS[s.reason] || s.reason}`).join('\n');
  }
  alert(msg);
  closeTrainingRosterModal();
  renderTrainingClasses();
}

// ---------- NGÂN HÀNG CÂU HỎI (bài test tạo độc lập, gán vào lớp khi Tạo Lớp Học Mới) ----------
let tbQuestions = []; // [{ text, type: 'SINGLE'|'MULTI', points, options: [{text, correct}] }]

function tbAddQuestion() {
  tbQuestions.push({ text: '', type: 'SINGLE', points: 1, options: [{ text: '', correct: false }, { text: '', correct: false }] });
  renderTestBuilderQuestions();
}
function tbRemoveQuestion(qi) { tbQuestions.splice(qi, 1); renderTestBuilderQuestions(); }
function tbAddOption(qi) { tbQuestions[qi].options.push({ text: '', correct: false }); renderTestBuilderQuestions(); }
function tbRemoveOption(qi, oi) { tbQuestions[qi].options.splice(oi, 1); renderTestBuilderQuestions(); }
function tbUpdateQuestionField(qi, field, value) { tbQuestions[qi][field] = value; renderTestBuilderQuestions(); }
// 3 hàm dưới đây KHÔNG gọi renderTestBuilderQuestions() (khác tbUpdateQuestionField() ở trên) — cố ý,
// vì đây là input text đang gõ dở: re-render lại toàn bộ danh sách câu hỏi mỗi ký tự sẽ làm mất focus/vị
// trí con trỏ đang gõ (khác 'type'/checkbox chỉ đổi khi bấm 1 lần, re-render không ảnh hưởng UX).
function tbSetQuestionText(qi, value) { tbQuestions[qi].text = value; }
function tbSetQuestionPoints(qi, value) { tbQuestions[qi].points = Number(value) || 1; }
function tbSetOptionText(qi, oi, value) { tbQuestions[qi].options[oi].text = value; }
// Loại "1 đáp án đúng" mô phỏng hành vi radio (chọn 1 thì bỏ chọn các đáp án khác) dù dùng chung ô
// checkbox cho cả 2 loại câu hỏi — đơn giản hoá UI, không cần đổi input type qua lại khi đổi loại câu hỏi.
function tbToggleCorrect(qi, oi, checkboxEl) {
  const q = tbQuestions[qi];
  if (q.type === 'SINGLE') q.options.forEach((o, idx) => { o.correct = idx === oi; });
  else q.options[oi].correct = checkboxEl.checked;
  renderTestBuilderQuestions();
}

function renderTestBuilderQuestions() {
  const wrap = document.getElementById('tbQuestionsContainer');
  if (!wrap) return;
  if (!tbQuestions.length) {
    wrap.innerHTML = `<p class="text-gray-400 italic text-xs">Chưa có câu hỏi nào — bấm "+ Thêm Câu Hỏi" bên dưới.</p>`;
    return;
  }
  wrap.innerHTML = tbQuestions.map((q, qi) => `
    <div class="border rounded p-3 space-y-2 bg-gray-50">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-bold text-gray-500">#${qi + 1}</span>
        <input value="${escapeHtml(q.text)}" data-op-input="tbSetQuestionText" data-arg0="${qi}" data-arg-value="1" placeholder="Nội dung câu hỏi..." class="flex-1 min-w-[200px] border p-1.5 rounded text-xs">
        <select data-op-change="tbUpdateQuestionField" data-arg0="${qi}" data-arg1="type" data-arg-value="2" class="border p-1.5 rounded text-xs bg-white">
          <option value="SINGLE" ${q.type === 'SINGLE' ? 'selected' : ''}>1 đáp án đúng</option>
          <option value="MULTI" ${q.type === 'MULTI' ? 'selected' : ''}>Nhiều đáp án đúng</option>
        </select>
        <input type="number" min="1" value="${q.points}" data-op-input="tbSetQuestionPoints" data-arg0="${qi}" data-arg-value="1" title="Điểm câu này" class="w-16 border p-1.5 rounded text-xs">
        <button type="button" data-op="tbRemoveQuestion" data-arg0="${qi}" class="text-red-500 font-bold text-xs hover:underline">Xoá Câu</button>
      </div>
      <div class="space-y-1 pl-4">
        ${q.options.map((o, oi) => `
          <div class="flex items-center gap-2">
            <input type="checkbox" ${o.correct ? 'checked' : ''} data-op-change="tbToggleCorrect" data-arg0="${qi}" data-arg1="${oi}" data-arg-el="2" title="Đáp án đúng">
            <input value="${escapeHtml(o.text)}" data-op-input="tbSetOptionText" data-arg0="${qi}" data-arg1="${oi}" data-arg-value="2" placeholder="Đáp án ${oi + 1}" class="flex-1 border p-1 rounded text-xs">
            <button type="button" data-op="tbRemoveOption" data-arg0="${qi}" data-arg1="${oi}" class="text-red-400 text-xs hover:underline">&times;</button>
          </div>`).join('')}
        <button type="button" data-op="tbAddOption" data-arg0="${qi}" class="text-indigo-600 text-xs font-bold hover:underline">+ Thêm Đáp Án</button>
      </div>
    </div>`).join('');
}

async function submitTrainingTest(e) {
  e.preventDefault();
  if (!canManageTrainingLocal(currentUser)) return alert('⛔ Bạn không có quyền tạo bài test!');
  const title = document.getElementById('ttTitle').value.trim();
  if (!title) return alert('Vui lòng nhập tên bài test!');
  if (!tbQuestions.length) return alert('Vui lòng thêm ít nhất 1 câu hỏi!');
  for (let i = 0; i < tbQuestions.length; i++) {
    const q = tbQuestions[i];
    if (!q.text.trim()) return alert(`Câu hỏi số ${i + 1} thiếu nội dung!`);
    const filled = q.options.filter(o => o.text.trim());
    if (filled.length < 2) return alert(`Câu hỏi số ${i + 1} cần ít nhất 2 đáp án!`);
    if (!filled.some(o => o.correct)) return alert(`Câu hỏi số ${i + 1} chưa chọn đáp án đúng!`);
  }
  const payload = {
    title,
    category: document.getElementById('ttCategory').value,
    passScore: document.getElementById('ttPassScore').value,
    questions: tbQuestions.map(q => {
      const filled = q.options.filter(o => o.text.trim());
      return {
        text: q.text.trim(), type: q.type, points: q.points,
        options: filled.map(o => ({ text: o.text.trim() })),
        correctOptionIds: filled.map((o, idx) => o.correct ? idx + 1 : null).filter(x => x != null)
      };
    })
  };
  let newTest;
  try {
    const result = await callCreateAction('trainingTests', payload);
    newTest = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  DB.trainingTests.unshift(newTest);
  logSystemAction('INTERNAL', 'CREATE_TRAINING_TEST', `Tạo bài test đào tạo [${newTest.title}]`, 'SUCCESS');
  alert('✅ Đã tạo bài test thành công!');
  document.getElementById('ttTitle').value = '';
  document.getElementById('ttCategory').value = '';
  document.getElementById('ttPassScore').value = '';
  tbQuestions = [];
  renderTestBuilderQuestions();
  renderTrainingTests();
  populateTrainingClassMultiSelects();
}

function renderTrainingTests() {
  const container = document.getElementById('trainingTestsContainer');
  if (!container) return;
  const list = DB.trainingTests.slice().sort((a, b) => b.id - a.id);

  document.getElementById('paginationContainer_trainingTests').innerHTML = buildPaginationBoxHTML('trainingTests', 'renderTrainingTests');
  const pageItems = paginateList('trainingTests', list, 'renderTrainingTests', 'bài test');

  if (!pageItems.length) { container.innerHTML = `<p class="text-gray-400 italic text-xs col-span-2">Chưa có bài test nào.</p>`; return; }
  container.innerHTML = pageItems.map(t => {
    const totalPoints = t.questions.reduce((s, q) => s + q.points, 0);
    const delHTML = currentUser.perms?.admin ? `<button data-op="deleteTrainingTest" data-arg0="${t.id}" class="text-red-500 font-bold hover:underline text-xs ml-2">Xóa</button>` : '';
    return `<div class="border rounded p-3 bg-white text-xs">
      <div class="flex justify-between items-start gap-2">
        <div>
          <div class="font-bold text-gray-800">${escapeHtml(t.title)}</div>
          <div class="text-gray-500 mt-0.5">${t.questions.length} câu hỏi · ${totalPoints} điểm${t.category ? ' · ' + escapeHtml(t.category) : ''}${t.passScore != null ? ` · Gợi ý đạt ${t.passScore}%` : ''}</div>
        </div>
        ${delHTML}
      </div>
    </div>`;
  }).join('');
}

function deleteTrainingTest(id) {
  if (!confirm('Xóa bài test này? Các lớp học đang gán bài test này sẽ không còn dùng để nộp bài được nữa.')) return;
  callRecordAction('trainingTests', id, 'delete', {}).then(() => {
    DB.trainingTests = DB.trainingTests.filter(t => t.id !== id);
    logSystemAction('INTERNAL', 'DELETE_TRAINING_TEST', `Xóa bài test [id ${id}]`, 'SUCCESS');
    renderTrainingTests();
    populateTrainingClassMultiSelects();
  }).catch(err => alert(`⛔ ${err.message}`));
}

// ---------- ĐĂNG KÝ CỦA TÔI ----------
function renderTrainingMyRegs() {
  const tbody = document.getElementById('trainingMyRegsTableBody');
  if (!tbody) return;
  const mine = DB.trainingRegistrations.filter(r => r.creator === currentUser.username && r.result !== 'CANCELLED').sort((a, b) => b.id - a.id);

  document.getElementById('paginationContainer_trainingMyRegs').innerHTML = buildPaginationBoxHTML('trainingMyRegs', 'renderTrainingMyRegs');
  const pageItems = paginateList('trainingMyRegs', mine, 'renderTrainingMyRegs', 'đăng ký');

  if (!pageItems.length) { tbody.innerHTML = `<tr><td colspan="5" class="text-center p-4 text-gray-400 italic">Bạn chưa đăng ký lớp học nào.</td></tr>`; return; }
  const now = new Date();
  tbody.innerHTML = pageItems.map(r => {
    const cls = DB.trainingClasses.find(c => c.id === r.classId);
    // Đợt 3: badge dùng lớp phủ Chờ/Đang học/Hoàn thành (getTrainingRegDisplayStatus()) thay cho suy
    // trực tiếp từ result — KHÔNG đổi ý nghĩa result gốc, chỉ đổi CÁCH HIỂN THỊ (xem baseline).
    const disp = getTrainingRegDisplayStatus(r, cls);
    const badgeCls = disp.key === 'DONE' ? (r.result === 'PASSED' ? 'text-emerald-600' : 'text-red-600') : 'text-indigo-600';
    const badgeIcon = disp.key === 'DONE' ? (r.result === 'PASSED' ? '✅' : '❌') : disp.key === 'WAITING' ? '⏳' : '📌';
    const badge = `<span class="${badgeCls} font-bold">${badgeIcon} ${escapeHtml(disp.label)}${disp.sub ? ` (${escapeHtml(disp.sub)})` : ''}${disp.key === 'DONE' && r.score != null ? ` — ${r.score} điểm` : ''}</span>`;
    // Đợt 9 — yêu cầu huỷ giờ phải chờ trainingManage/admin duyệt (xem cancelTrainingRegistration(),
    // lib/recordActions.js) — học viên chỉ gửi được 1 yêu cầu, không huỷ lại được lần 2 khi đang chờ.
    const cancelHTML = r.pendingCancellation
      ? `<span class="text-xs text-amber-600 font-bold">⏳ Đang chờ duyệt huỷ</span>`
      : r.result === 'REGISTERED' ? `<button data-op="cancelTrainingRegistrationAction" data-arg0="${r.id}" class="text-red-500 font-bold hover:underline text-xs">Huỷ Đăng Ký</button>` : '';
    // Đợt 9.1 — "Vào Lớp Học" giờ LUÔN hiện cho MỌI đăng ký còn REGISTERED, cả ONLINE lẫn OFFLINE (trước
    // đây chỉ hiện cho ONLINE có gán giáo trình bắt buộc — học viên lớp OFFLINE hoặc ONLINE không giáo
    // trình không có chỗ nào để bấm vào, chỉ thấy 1 dòng chữ khoá). Nội dung modal khác nhau theo
    // cls.mode (xem renderTrainingJoinClassModalBody()): ONLINE hiện danh sách tài liệu bắt buộc (nếu
    // có) để đánh dấu đã xem; OFFLINE hiện thông tin buổi học (địa điểm/thời gian/giảng viên/trạng thái)
    // + hướng dẫn quét mã QR khi buổi học đã kết thúc. Bài test vẫn gác đúng như Đợt 9 (xem
    // routes/records.js submit-test): ONLINE cần xem hết giáo trình bắt buộc + qua endTime, OFFLINE cần
    // giảng viên bấm "Kết Thúc Lớp".
    let testHTML = '';
    if (cls && r.result === 'REGISTERED') {
      if (cls.mode === 'OFFLINE') {
        testHTML += `<button data-op="openTrainingJoinClassModal" data-arg0="${r.id}" class="bg-sky-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-sky-700 mt-1 mr-1">📍 Vào Lớp Học</button>`;
        if (cls.testId != null) {
          testHTML += getTrainingClassSessionState(cls) === 'ENDED'
            ? `<div class="text-xs text-gray-400 mt-1">🧪 Quét mã QR tại lớp để làm bài</div>`
            : `<div class="text-xs text-gray-400 mt-1">🔒 Chờ giảng viên bấm "Kết Thúc Lớp" để mở bài test</div>`;
        }
      } else {
        const requiredDocIds = Array.isArray(cls.documentIds) ? cls.documentIds : [];
        const viewedIds = Array.isArray(r.viewedDocumentIds) ? r.viewedDocumentIds : [];
        const viewedCount = requiredDocIds.filter(id => viewedIds.includes(id)).length;
        const allViewed = !requiredDocIds.length || viewedCount === requiredDocIds.length;
        testHTML += `<button data-op="openTrainingJoinClassModal" data-arg0="${r.id}" class="bg-sky-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-sky-700 mt-1 mr-1">📚 Vào Lớp Học${requiredDocIds.length ? ` (${viewedCount}/${requiredDocIds.length})` : ''}</button>`;
        if (cls.testId != null) {
          if (!cls.endTime) {
            testHTML += `<div class="text-xs text-gray-400 mt-1">🧪 Lớp chưa có giờ kết thúc, chưa thể mở bài test</div>`;
          } else if (now < new Date(cls.endTime)) {
            testHTML += `<div class="text-xs text-gray-400 mt-1">🔒 Bài test mở lúc ${escapeHtml(cls.endTime.replace('T', ' '))}</div>`;
          } else if (!allViewed) {
            testHTML += `<div class="text-xs text-amber-600 mt-1">📖 Cần xem hết tài liệu giáo trình trước khi thi</div>`;
          } else {
            testHTML += `<button data-op="openTakeTestModal" data-arg0="${cls.id}" class="bg-purple-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-purple-700 mt-1">📝 Vào Làm Bài Test</button>`;
          }
        }
      }
    }
    return `
      <tr class="hover:bg-gray-50">
        <td class="border p-2">${escapeHtml(r.classCode || '')}<br>${escapeHtml(r.className || '')}</td>
        <td class="border p-2">${escapeHtml(r.category || '')}</td>
        <td class="border p-2">${escapeHtml(r.registeredAt || '')}</td>
        <td class="border p-2">${badge}</td>
        <td class="border p-2 text-center">${cancelHTML}${testHTML}</td>
      </tr>`;
  }).join('');
}

// Đợt 9 — huỷ không còn có hiệu lực ngay: học viên (không phải admin) chỉ gửi được 1 yêu cầu, chờ
// trainingManage/admin duyệt (xem cancelTrainingRegistration()/approveCancelTrainingRegistration(),
// lib/recordActions.js) — server tự phân biệt admin (huỷ ngay) hay không (tạo yêu cầu chờ), thông báo
// cho đúng theo kết quả trả về thay vì giả định trước.
function cancelTrainingRegistrationAction(regId) {
  if (!confirm('Gửi yêu cầu huỷ đăng ký lớp học này? Cần Nhân Sự phụ trách đào tạo duyệt trước khi có hiệu lực (trừ khi bạn là Admin).')) return;
  const reason = (prompt('Lý do huỷ (không bắt buộc):') || '').trim();
  callRecordAction('trainingRegistrations', regId, 'cancel', { reason }).then(result => {
    const updated = result.item;
    const idx = DB.trainingRegistrations.findIndex(x => x.id === regId);
    if (idx !== -1) DB.trainingRegistrations[idx] = updated;
    logSystemAction('INTERNAL', 'CANCEL_TRAINING_REG', `${updated.result === 'CANCELLED' ? 'Huỷ' : 'Gửi yêu cầu huỷ'} đăng ký lớp học [id ${regId}]`, 'SUCCESS');
    alert(updated.result === 'CANCELLED' ? '✅ Đã huỷ đăng ký thành công!' : '✅ Đã gửi yêu cầu huỷ, chờ Nhân Sự phụ trách đào tạo duyệt.');
    renderTrainingMyRegs();
    renderTrainingClasses();
  }).catch(err => alert(`⛔ ${err.message}`));
}

// ---------- VÀO LỚP HỌC (Đợt 9 — ONLINE, đánh dấu đã xem từng tài liệu giáo trình bắt buộc) ----------
let trainingJoinClassRegId = null;
function openTrainingJoinClassModal(regId) {
  trainingJoinClassRegId = regId;
  renderTrainingJoinClassModalBody();
  document.getElementById('trainingJoinClassModal').classList.remove('hidden');
}
function closeTrainingJoinClassModal() {
  document.getElementById('trainingJoinClassModal').classList.add('hidden');
}
// Cùng cách hiển thị theo docType (VIDEO nhúng Youtube/IMAGE thumbnail/DOCUMENT link tải) với
// renderTrainingDocuments() ở Kho Tài Liệu — dùng chung cho cả 2 nhánh ONLINE/OFFLINE của
// renderTrainingJoinClassModalBody() bên dưới.
function trainingDocOpenLinkHTML(d) {
  if (d.docType === 'VIDEO') {
    const embedUrl = trainingYoutubeEmbedUrl(d.videoUrl);
    return embedUrl
      ? `<iframe src="${escapeHtml(embedUrl)}" class="w-full h-40 rounded border" frameborder="0" allowfullscreen title="${escapeHtml(d.title)}"></iframe>`
      : `<a href="${escapeHtml(d.videoUrl || '')}" target="_blank" rel="noopener" class="text-indigo-600 underline text-xs">▶️ Xem video</a>`;
  }
  if (d.docType === 'IMAGE') {
    return `<a href="${escapeHtml(d.fileUrl)}" target="_blank" rel="noopener"><img src="${escapeHtml(d.fileUrl)}" class="w-full max-h-40 object-contain rounded border" alt="${escapeHtml(d.title)}"></a>`;
  }
  return `<a href="${escapeHtml(d.fileUrl)}" target="_blank" rel="noopener" class="text-indigo-600 underline text-xs">⬇️ Mở tài liệu</a>`;
}

// Đợt 9.1 — modal "Vào Lớp Học" giờ dùng chung cho CẢ ONLINE lẫn OFFLINE (trước đây chỉ ONLINE có
// giáo trình bắt buộc mới có màn này). ONLINE: liệt kê giáo trình bắt buộc (nếu có) kèm nút đánh dấu đã
// xem — bắt buộc xem hết mới mở được bài test (gác ở routes/records.js submit-test). OFFLINE: hiện
// thông tin buổi học (địa điểm/thời gian/giảng viên/trạng thái) + tài liệu tham khảo (nếu có, KHÔNG bắt
// buộc đánh dấu đã xem vì gác OFFLINE là sessionState, không phải xem tài liệu) + hướng dẫn quét mã QR.
function renderTrainingJoinClassModalBody() {
  const reg = DB.trainingRegistrations.find(r => r.id === trainingJoinClassRegId);
  const cls = reg && DB.trainingClasses.find(c => c.id === reg.classId);
  const container = document.getElementById('trainingJoinClassBody');
  if (!reg || !cls) { container.innerHTML = ''; return; }
  document.getElementById('trainingJoinClassTitle').innerText = `${cls.mode === 'OFFLINE' ? '📍' : '📚'} Vào Lớp Học — ${cls.title}`;
  const docIds = Array.isArray(cls.documentIds) ? cls.documentIds : [];

  if (cls.mode === 'OFFLINE') {
    const sessionState = getTrainingClassSessionState(cls);
    const sessionBadgeCls = sessionState === 'ONGOING' ? 'bg-emerald-100 text-emerald-700' : sessionState === 'ENDED' ? 'bg-gray-200 text-gray-600' : 'bg-amber-100 text-amber-700';
    const infoHTML = `
      <div class="bg-white border rounded p-3 space-y-1 text-sm">
        <div>📍 <b>Địa điểm:</b> ${escapeHtml(cls.location || 'Chưa cập nhật')}</div>
        <div>🕒 <b>Thời gian:</b> ${escapeHtml((cls.startTime || '').replace('T', ' '))}${cls.endTime ? ` ➔ ${escapeHtml(cls.endTime.replace('T', ' '))}` : ''}</div>
        ${cls.instructor ? `<div>👤 <b>Giảng viên:</b> ${escapeHtml(cls.instructor)}</div>` : ''}
        <div><b>Trạng thái buổi học:</b> <span class="text-xs px-2 py-0.5 rounded ${sessionBadgeCls}">${TRAINING_SESSION_STATE_LABELS[sessionState]}</span></div>
      </div>`;
    const docsHTML = docIds.length
      ? `<div class="space-y-2">
          <div class="text-xs font-bold text-gray-500">📎 Tài liệu tham khảo</div>
          ${docIds.map(docId => {
            const d = DB.trainingDocuments.find(x => x.id === docId);
            if (!d) return '';
            return `<div class="bg-white border rounded p-3 space-y-2"><div class="font-bold text-sm text-gray-800">${escapeHtml(d.title)}</div>${trainingDocOpenLinkHTML(d)}</div>`;
          }).join('')}
        </div>`
      : '';
    const guideHTML = cls.testId == null
      ? ''
      : sessionState === 'ENDED'
        ? `<div class="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">🧪 Buổi học đã kết thúc — quét mã QR do giảng viên chiếu tại lớp để vào làm bài test.</div>`
        : `<div class="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">🔒 Buổi học chưa kết thúc — giảng viên bấm "Kết Thúc Lớp" xong mới mở được bài test.</div>`;
    container.innerHTML = `<div class="space-y-3">${infoHTML}${docsHTML}${guideHTML}</div>`;
    return;
  }

  // ONLINE
  if (!docIds.length) { container.innerHTML = `<div class="text-gray-400 italic text-sm">Lớp học này không có giáo trình bắt buộc.</div>`; return; }
  const viewedIds = Array.isArray(reg.viewedDocumentIds) ? reg.viewedDocumentIds : [];
  container.innerHTML = docIds.map(docId => {
    const d = DB.trainingDocuments.find(x => x.id === docId);
    if (!d) return '';
    const isViewed = viewedIds.includes(docId);
    return `
      <div class="bg-white border rounded p-3 space-y-2">
        <div class="flex justify-between items-start gap-2">
          <div class="font-bold text-sm text-gray-800">${escapeHtml(d.title)}</div>
          ${isViewed ? `<span class="text-xs px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold flex-shrink-0">✅ Đã xem</span>` : ''}
        </div>
        ${trainingDocOpenLinkHTML(d)}
        ${isViewed ? '' : `<button data-op="markTrainingDocumentViewedAction" data-arg0="${docId}" class="bg-emerald-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-emerald-700">Đánh dấu đã xem</button>`}
      </div>`;
  }).join('');
}
async function markTrainingDocumentViewedAction(documentId) {
  const regId = trainingJoinClassRegId;
  let updated;
  try {
    const res = await callRecordAction('trainingRegistrations', regId, 'mark-document-viewed', { documentId });
    updated = res.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.trainingRegistrations.findIndex(x => x.id === regId);
  if (idx !== -1) DB.trainingRegistrations[idx] = updated;
  renderTrainingJoinClassModalBody();
  renderTrainingMyRegs();
}

// ---------- LÀM BÀI TEST (đếm ngược theo từng câu, không cho quay lại câu trước) ----------
let ttTakeClassId = null;
let ttTakeQuestions = [];
let ttTakeAnswers = {}; // questionId -> [selectedOptionIds]
let ttTakeIndex = 0;
let ttTakeSecondsPerQuestion = 120;
let ttTakeSecondsLeft = 0;
let ttTakeTimerHandle = null;

// Đảo câu hỏi + đáp án (Đợt 4) — trả về 1 BẢN SAO đã xáo trộn thứ tự phần tử (Fisher-Yates), KHÔNG bao
// giờ sửa mảng gốc truyền vào (test.questions/q.options vẫn nguyên vẹn thứ tự lưu ở DB.trainingTests).
function shuffleArrayCopy(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function openTakeTestModal(classId) {
  const cls = DB.trainingClasses.find(c => c.id === classId);
  if (!cls || cls.testId == null) return alert('Lớp học này chưa được gán bài test.');
  const test = DB.trainingTests.find(t => t.id === cls.testId);
  if (!test || !Array.isArray(test.questions) || !test.questions.length) return alert('Không tìm thấy nội dung bài test.');
  // Báo server mốc BẮT ĐẦU làm bài (POST .../start-test, server chỉ ghi LẦN ĐẦU) để lúc nộp còn đối
  // chiếu được thời gian làm thật — đồng hồ đếm ngược bên dưới thuần client, tự nó không chứng minh
  // được gì (xem evaluateTrainingTestTiming() ở lib/recordActions.js). CỐ Ý không await: hàm này vẫn
  // phải là hàm ĐỒNG BỘ (mở đề ra ngay, không bắt học viên chờ 1 lượt mạng) và lỗi ở đây KHÔNG được
  // chặn người đang làm bài — mất dấu thời gian còn hơn chặn oan.
  callRecordAction('trainingClasses', classId, 'start-test', {})
    .then(started => {
      const rIdx = DB.trainingRegistrations.findIndex(r => r.id === started.item?.id);
      if (rIdx !== -1) DB.trainingRegistrations[rIdx] = started.item;
    })
    .catch(err => console.warn('Không ghi được mốc bắt đầu bài test:', err.message));
  clearInterval(ttTakeTimerHandle);
  ttTakeClassId = classId;
  // Đảo cả thứ tự câu hỏi lẫn thứ tự đáp án trong từng câu — mỗi lượt mở modal (kể cả làm lại) xáo trộn
  // lại từ đầu, dùng ĐÚNG bản sao (test.questions ở DB.trainingTests không bị đụng tới). Vẫn giữ nguyên
  // id thật của câu hỏi/đáp án nên bài nộp (ttTakeSubmit() gửi theo q.id/o.id) và chấm điểm
  // (gradeTrainingTestSubmission(), so sánh theo id dạng tập hợp, không theo thứ tự) hoàn toàn không bị
  // ảnh hưởng.
  ttTakeQuestions = shuffleArrayCopy(test.questions).map(q => Object.assign({}, q, { options: shuffleArrayCopy(q.options) }));
  ttTakeAnswers = {};
  ttTakeIndex = 0;
  ttTakeSecondsPerQuestion = cls.testSecondsPerQuestion > 0 ? cls.testSecondsPerQuestion : 120;
  document.getElementById('ttTakeModalTitle').innerText = `🧪 ${test.title}`;
  document.getElementById('ttTakeModalSubtitle').innerText = `Lớp: ${cls.title}`;
  document.getElementById('trainingTakeTestModal').classList.remove('hidden');
  ttTakeRenderQuestion();
}

function ttTakeExit() {
  if (!confirm('Thoát khỏi bài test? Câu trả lời chưa nộp sẽ không được lưu — bạn có thể vào làm lại từ đầu (miễn là chưa nộp bài lần nào cho lớp này).')) return;
  clearInterval(ttTakeTimerHandle);
  document.getElementById('trainingTakeTestModal').classList.add('hidden');
}

function ttTakeRenderQuestion() {
  const q = ttTakeQuestions[ttTakeIndex];
  const total = ttTakeQuestions.length;
  document.getElementById('ttTakeQuestionCounter').innerText = `Câu ${ttTakeIndex + 1} / ${total}${q.type === 'MULTI' ? ' — có thể chọn nhiều đáp án' : ''}`;
  document.getElementById('ttTakeQuestionText').innerText = q.text;
  document.getElementById('ttTakeProgressBar').style.width = `${Math.round((ttTakeIndex / total) * 100)}%`;
  const selected = ttTakeAnswers[q.id] || [];
  const inputType = q.type === 'MULTI' ? 'checkbox' : 'radio';
  document.getElementById('ttTakeOptionsContainer').innerHTML = q.options.map(o => `
    <label class="flex items-center gap-2 border rounded p-2 hover:bg-gray-50 cursor-pointer">
      <input type="${inputType}" name="ttTakeOpt" value="${o.id}" ${selected.includes(o.id) ? 'checked' : ''} data-op-change="ttTakeToggleOptionFromCheckbox" data-arg0="${o.id}" data-arg-el="1">
      <span class="text-sm">${escapeHtml(o.text)}</span>
    </label>`).join('');
  document.getElementById('ttTakeNextBtn').innerText = ttTakeIndex === total - 1 ? '✅ Nộp Bài' : 'Câu Tiếp Theo →';

  ttTakeSecondsLeft = ttTakeSecondsPerQuestion;
  ttTakeUpdateTimerDisplay();
  clearInterval(ttTakeTimerHandle);
  ttTakeTimerHandle = setInterval(() => {
    ttTakeSecondsLeft--;
    ttTakeUpdateTimerDisplay();
    if (ttTakeSecondsLeft <= 0) { clearInterval(ttTakeTimerHandle); ttTakeGoNext(); }
  }, 1000);
}

function ttTakeUpdateTimerDisplay() {
  const secs = Math.max(0, ttTakeSecondsLeft);
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  const el = document.getElementById('ttTakeTimer');
  el.innerText = `${m}:${s}`;
  el.className = 'text-2xl font-bold tabular-nums ' + (secs <= 10 ? 'text-red-600' : 'text-indigo-600');
}

function ttTakeSelectOption(optId, checked) {
  const q = ttTakeQuestions[ttTakeIndex];
  const cur = ttTakeAnswers[q.id] || [];
  ttTakeAnswers[q.id] = q.type === 'MULTI' ? (checked ? [...new Set([...cur, optId])] : cur.filter(id => id !== optId)) : [optId];
}
// CSP: onchange checkbox chỉ truyền được phần tử qua data-arg-el (không có slot "this.checked" —
// xem cspReadArgSlot), nên tách riêng wrapper đọc .checked từ phần tử rồi mới gọi hàm lõi ở trên
// (hàm lõi giữ nguyên chữ ký cũ nhận thẳng boolean — tests gọi trực tiếp hàm lõi này).
function ttTakeToggleOptionFromCheckbox(optId, checkboxEl) {
  ttTakeSelectOption(optId, checkboxEl.checked);
}

async function ttTakeGoNext() {
  clearInterval(ttTakeTimerHandle);
  if (ttTakeIndex < ttTakeQuestions.length - 1) {
    ttTakeIndex++;
    ttTakeRenderQuestion();
  } else {
    await ttTakeSubmit();
  }
}

async function ttTakeSubmit() {
  const answers = ttTakeQuestions.map(q => ({ questionId: q.id, selectedOptionIds: ttTakeAnswers[q.id] || [] }));
  let result;
  try {
    result = await callRecordAction('trainingClasses', ttTakeClassId, 'submit-test', { answers });
  } catch (err) {
    document.getElementById('trainingTakeTestModal').classList.add('hidden');
    return alert(`⛔ ${err.message}`);
  }
  document.getElementById('trainingTakeTestModal').classList.add('hidden');
  const idx = DB.trainingRegistrations.findIndex(r => r.id === result.registration.id);
  if (idx !== -1) DB.trainingRegistrations[idx] = result.registration;
  else DB.trainingRegistrations.unshift(result.registration);
  logSystemAction('INTERNAL', 'SUBMIT_TRAINING_TEST', `Nộp bài test lớp [${result.registration.classCode}]`, 'SUCCESS', result.registration.classCode);
  const sub = result.submission;
  alert(`✅ Đã nộp bài!\n\nĐiểm: ${sub.score}/${sub.totalPoints} (${sub.percentage}%)\nKết quả: ${sub.passed ? 'ĐẠT' : 'KHÔNG ĐẠT'}`);
  renderTrainingMyRegs();
  renderTrainingClasses();
}

// ---------- KHO TÀI LIỆU ----------
// Loại tài liệu (docType, Đợt 4) — toggle ô Tệp/Video theo lựa chọn, đổi luôn accept/nhãn ô Tệp cho
// IMAGE (chỉ ảnh) khác DOCUMENT (pdf/docx/xlsx như cũ).
function onTrainingDocTypeChange() {
  const type = document.getElementById('tdDocType').value;
  const fileField = document.getElementById('tdFileField');
  const videoField = document.getElementById('tdVideoField');
  const fileInput = document.getElementById('tdFile');
  const videoInput = document.getElementById('tdVideoUrl');
  const fileLabel = document.getElementById('tdFileLabel');
  if (type === 'VIDEO') {
    fileField.classList.add('hidden'); videoField.classList.remove('hidden');
    fileInput.required = false; videoInput.required = true;
  } else {
    fileField.classList.remove('hidden'); videoField.classList.add('hidden');
    fileInput.required = true; videoInput.required = false;
    fileInput.accept = type === 'IMAGE' ? '.jpg,.jpeg,.png,.webp' : '.pdf,.docx,.xlsx';
    fileLabel.innerText = type === 'IMAGE' ? 'Ảnh Tài Liệu' : 'Tệp Tài Liệu';
  }
}

async function submitTrainingDocument(e) {
  e.preventDefault();
  if (!canManageTrainingLocal(currentUser)) return alert('⛔ Bạn không có quyền thêm tài liệu vào kho!');
  const category = document.getElementById('tdCategory').value;
  if (!category) return alert('Vui lòng chọn Loại Đào Tạo (thêm ở Quản Trị &gt; Quản Lý Danh Mục nếu chưa có)!');
  const docType = document.getElementById('tdDocType').value;
  const payload = {
    code: `TL-DT-${Date.now()}`,
    category,
    title: document.getElementById('tdTitle').value.trim(),
    description: document.getElementById('tdDescription').value.trim(),
    docType,
    mandatory: document.getElementById('tdMandatory').checked,
    courseId: document.getElementById('tdCourseId').value,
    createdAt: new Date().toLocaleString('vi-VN')
  };
  if (docType === 'VIDEO') {
    // VIDEO (Đợt 4) — nhúng Youtube qua link thay vì tải file, không gọi /api/upload.
    const videoUrl = document.getElementById('tdVideoUrl').value.trim();
    if (!videoUrl) return alert('Vui lòng nhập link video Youtube!');
    payload.videoUrl = videoUrl;
  } else {
    const file = document.getElementById('tdFile').files[0];
    if (!file) return alert(docType === 'IMAGE' ? 'Vui lòng chọn ảnh cần tải lên!' : 'Vui lòng chọn tệp tài liệu!');
    let uploaded;
    try {
      uploaded = await uploadFileToServer(file, 'internal');
    } catch (err) { return alert(`⛔ Tải tệp thất bại: ${err.message}`); }
    payload.fileUrl = uploaded.fileUrl; payload.fileName = uploaded.fileName; payload.fileType = uploaded.fileType;
  }
  let newDoc;
  try {
    const result = await callCreateAction('trainingDocuments', payload);
    newDoc = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  DB.trainingDocuments.unshift(newDoc);
  logSystemAction('INTERNAL', 'CREATE_TRAINING_DOC', `Thêm tài liệu đào tạo [${newDoc.title}]`, 'SUCCESS', newDoc.code);
  alert('✅ Đã thêm tài liệu vào kho thành công!');
  e.target.reset();
  onTrainingDocTypeChange();
  renderTrainingLms();
}

// Youtube embed URL (Đợt 4) — chấp nhận cả 2 dạng phổ biến (youtube.com/watch?v=... và youtu.be/...),
// trả về null nếu không tách được video id (client vẫn có link gốc để mở tab mới, xem renderTrainingDocuments()).
function trainingYoutubeEmbedUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    let videoId = null;
    if (u.hostname.replace(/^www\./, '') === 'youtu.be') {
      videoId = u.pathname.slice(1);
    } else if (u.hostname.replace(/^www\./, '').endsWith('youtube.com')) {
      videoId = u.searchParams.get('v');
      if (!videoId && u.pathname.startsWith('/embed/')) videoId = u.pathname.split('/embed/')[1];
    }
    return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
  } catch (e) { return null; }
}

function onTrainingDocFilterCategoryChange() { resetListPage('trainingDocuments'); renderTrainingDocuments(); }

function renderTrainingDocuments() {
  const container = document.getElementById('trainingDocumentsContainer');
  if (!container) return;
  const filterCat = document.getElementById('trainingDocFilterCategory')?.value || '';
  const list = DB.trainingDocuments.filter(d => !filterCat || d.category === filterCat).sort((a, b) => b.id - a.id);

  document.getElementById('paginationContainer_trainingDocuments').innerHTML = buildPaginationBoxHTML('trainingDocuments', 'renderTrainingDocuments');
  const pageItems = paginateList('trainingDocuments', list, 'renderTrainingDocuments', 'tài liệu');

  if (!pageItems.length) { container.innerHTML = `<div class="col-span-2 text-center p-6 text-gray-400 italic bg-white rounded border">Kho tài liệu đang trống.</div>`; return; }
  container.innerHTML = pageItems.map(d => {
    // Chương Trình (courseId, Đợt 4, tuỳ chọn) — hiển thị bổ sung bên cạnh "Loại Đào Tạo" (category)
    // đã có từ trước, không thay thế.
    const course = d.courseId != null ? DB.trainingCourses.find(c => c.id === d.courseId) : null;
    const mandatoryBadge = d.mandatory ? ' <span class="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold align-middle">⚠️ Bắt buộc</span>' : '';
    // docType (Đợt 4): DOCUMENT giữ nguyên link tải cũ; VIDEO nhúng iframe Youtube; IMAGE hiện thumbnail
    // thay vì link tải (fileUrl vẫn là 1 file thật đã tải lên, chỉ khác cách hiển thị).
    let actionHTML;
    if (d.docType === 'VIDEO') {
      const embedUrl = trainingYoutubeEmbedUrl(d.videoUrl);
      actionHTML = embedUrl
        ? `<iframe src="${escapeHtml(embedUrl)}" class="w-40 h-24 rounded border" frameborder="0" allowfullscreen title="${escapeHtml(d.title)}"></iframe>`
        : `<a href="${escapeHtml(d.videoUrl || '')}" target="_blank" rel="noopener" class="text-indigo-600 underline text-xs">▶️ Xem video</a>`;
    } else if (d.docType === 'IMAGE') {
      actionHTML = `<a href="${escapeHtml(d.fileUrl)}" target="_blank" rel="noopener"><img src="${escapeHtml(d.fileUrl)}" class="w-24 h-24 object-cover rounded border" alt="${escapeHtml(d.title)}"></a>`;
    } else {
      actionHTML = `<a href="${escapeHtml(d.fileUrl)}" target="_blank" rel="noopener" class="bg-indigo-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-indigo-700 text-center">⬇️ Tải</a>`;
    }
    return `
    <div class="bg-white rounded border p-3 flex justify-between items-start gap-2">
      <div class="min-w-0">
        <div class="font-bold text-gray-800 text-sm">${escapeHtml(d.title)}${mandatoryBadge}</div>
        <div class="text-xs text-gray-500">${escapeHtml(d.category)} — ${escapeHtml(d.uploaderName || '')}${course ? ` — Chương trình: ${escapeHtml(course.name)}` : ''}</div>
        ${d.description ? `<div class="text-xs text-gray-600 mt-1">${escapeHtml(d.description)}</div>` : ''}
      </div>
      <div class="flex flex-col gap-1 flex-shrink-0 items-end">
        ${actionHTML}
        ${currentUser.perms?.admin ? `<button data-op="deleteTrainingDocument" data-arg0="${d.id}" class="text-red-500 font-bold hover:underline text-xs">Xóa</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function deleteTrainingDocument(id) {
  if (!confirm('Xóa tài liệu này khỏi kho?')) return;
  callRecordAction('trainingDocuments', id, 'delete', {}).then(() => {
    DB.trainingDocuments = DB.trainingDocuments.filter(d => d.id !== id);
    logSystemAction('INTERNAL', 'DELETE_TRAINING_DOC', `Xóa tài liệu đào tạo [id ${id}]`, 'SUCCESS');
    renderTrainingDocuments();
    populateTrainingClassMultiSelects();
  }).catch(err => alert(`⛔ ${err.message}`));
}

// ---------- LỘ TRÌNH THĂNG TIẾN (Đợt 7 — nhiều CẤP BẬC tuần tự) ----------
async function submitCareerPath(e) {
  e.preventDefault();
  if (!canManageTrainingLocal(currentUser)) return alert('⛔ Bạn không có quyền tạo lộ trình thăng tiến!');
  const stageRows = [...document.querySelectorAll('#cpStageBuilderContainer .cp-stage-row')];
  if (!stageRows.length) return alert('Vui lòng thêm ít nhất 1 cấp bậc cho lộ trình!');
  const stages = [];
  for (const row of stageRows) {
    const name = row.querySelector('.cp-stage-name-input').value.trim();
    const requiredCourseIds = [...row.querySelector('.cp-stage-course-select').selectedOptions].map(o => Number(o.value));
    if (!name) return alert('Vui lòng nhập tên cho tất cả các cấp bậc!');
    if (!requiredCourseIds.length) return alert(`Cấp bậc "${name}" cần chọn ít nhất 1 chương trình bắt buộc!`);
    stages.push({ name, requiredCourseIds });
  }
  const payload = {
    code: `LT-${Date.now()}`,
    name: document.getElementById('cpName').value.trim(),
    targetTitle: document.getElementById('cpTargetTitle').value.trim(),
    stages,
    description: document.getElementById('cpDescription').value.trim()
  };
  let newPath;
  try {
    const result = await callCreateAction('careerPaths', payload);
    newPath = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  DB.careerPaths.unshift(newPath);
  logSystemAction('INTERNAL', 'CREATE_CAREER_PATH', `Tạo lộ trình thăng tiến [${newPath.name}] (${newPath.stages.length} cấp bậc)`, 'SUCCESS', newPath.code);
  alert('✅ Đã tạo lộ trình thăng tiến thành công!');
  resetCareerPathForm();
  renderCareerPaths();
}

// Trạng thái TỪNG cấp bậc của 1 người (username) trên 1 lộ trình — tính SỐNG từ
// DB.trainingRegistrations/DB.trainingClasses/DB.careerPathConfirmations (không cần gọi API riêng, dùng
// CHUNG cho cả khối "Tiến độ của bạn" (renderCareerPaths, currentUser) lẫn khối tra cứu nhân viên khác
// của quản lý (renderCpEmployeeStageLookup) — mirrors ĐÚNG luật gác tuần tự phía server
// (confirmCareerPathForEmployee(), lib/recordActions.js): 1 cấp chỉ "unlocked" khi TẤT CẢ cấp trước đã
// được xác nhận, hoàn thành % chỉ là GỢI Ý hiển thị, KHÔNG tự mở khoá nút xác nhận (server mới là nơi
// chốt điều kiện, xem confirmCareerPathAction()).
function computeCareerPathStageStatuses(path, username) {
  const stages = Array.isArray(path.stages) ? path.stages : [];
  const myConfirmations = DB.careerPathConfirmations.filter(c => c.pathId === path.id && c.username === username);
  let unlocked = true;
  return stages.map((stage, idx) => {
    const confirmed = myConfirmations.some(c => c.stageIndex === idx);
    const requiredCourseIds = Array.isArray(stage.requiredCourseIds) ? stage.requiredCourseIds : [];
    // Đợt 8 — chỉ tính Đạt khi lớp CÓ gán bài test (c.testId != null, mirror ĐÚNG server xem
    // confirmCareerPathForEmployee()) — lớp không có test vẫn có thể bị chấm tay "Đạt" nhưng KHÔNG được
    // tính vào điều kiện xác nhận cấp bậc, bắt buộc phải thi thật.
    const done = requiredCourseIds.filter(courseId => DB.trainingRegistrations.some(r =>
      r.creator === username && r.result === 'PASSED' &&
      DB.trainingClasses.some(c => c.id === r.classId && c.courseId === courseId && c.testId != null))).length;
    const status = { index: idx, name: stage.name, total: requiredCourseIds.length, done, confirmed, unlocked };
    if (!confirmed) unlocked = false; // mọi cấp SAU cấp chưa xác nhận này đều bị khoá
    return status;
  });
}

// Hiển thị tuần tự từng cấp cho 1 người xem tiến độ CỦA CHÍNH HỌ (✅ Đã xác nhận / 🔓 Đang thực hiện +
// gợi ý Đủ điều kiện / 🔒 Chưa mở) — khoá tuần tự hiển thị RÕ ở UI, không chỉ gác ngầm ở server.
function renderCareerPathStagesHTML(path, username) {
  const statuses = computeCareerPathStageStatuses(path, username);
  return statuses.map(s => {
    const stageLabel = `Cấp ${s.index + 1}: ${escapeHtml(s.name)}`;
    if (s.confirmed) return `<div class="text-emerald-700">✅ ${stageLabel} — Đã xác nhận</div>`;
    if (!s.unlocked) return `<div class="text-gray-400">🔒 ${stageLabel} — Chưa mở, cần hoàn thành Cấp ${s.index} trước</div>`;
    const suggest = s.total > 0 && s.done >= s.total
      ? ` <span class="text-emerald-600 font-semibold">✅ Đủ điều kiện — chờ xác nhận Cấp ${s.index + 1}</span>`
      : '';
    return `<div class="text-gray-700">🔓 ${stageLabel} — Đang thực hiện — ${s.done}/${s.total} chương trình đã hoàn thành${suggest}</div>`;
  }).join('');
}

// Cấp bậc HIỆN TẠI của 1 nhân viên trên 1 lộ trình (cấp đầu tiên CHƯA được xác nhận — luôn "unlocked"
// đúng theo luật tuần tự, vì mọi cấp trước nó đều đã confirmed) — dùng cho khối tra cứu của quản lý
// (renderCpEmployeeStageLookup): null nghĩa là đã xác nhận xong TOÀN BỘ lộ trình.
function findCareerPathCurrentStage(path, username) {
  return computeCareerPathStageStatuses(path, username).find(s => !s.confirmed) || null;
}

function renderCareerPaths() {
  const container = document.getElementById('careerPathsContainer');
  if (!container) return;
  const list = DB.careerPaths.slice().sort((a, b) => b.id - a.id);

  document.getElementById('paginationContainer_careerPaths').innerHTML = buildPaginationBoxHTML('careerPaths', 'renderCareerPaths');
  const pageItems = paginateList('careerPaths', list, 'renderCareerPaths', 'lộ trình');

  if (!pageItems.length) { container.innerHTML = `<div class="text-center p-6 text-gray-400 italic bg-white rounded border">Chưa có lộ trình thăng tiến nào.</div>`; return; }
  const canManage = canManageTrainingLocal(currentUser);
  container.innerHTML = pageItems.map(p => {
    const stages = Array.isArray(p.stages) ? p.stages : [];
    const stagesSummaryHTML = stages.map((s, idx) => {
      const courseNames = (s.requiredCourseIds || []).map(id => {
        const c = DB.trainingCourses.find(x => x.id === id);
        return c ? escapeHtml(c.name) : `<span class="text-gray-400 italic">(chương trình đã xoá)</span>`;
      });
      return `<div><b>Cấp ${idx + 1}: ${escapeHtml(s.name)}</b> — ${courseNames.join(', ')}</div>`;
    }).join('');
    const myStatusHTML = renderCareerPathStagesHTML(p, currentUser.username);
    const manageHTML = canManage ? `
      <div class="mt-2 pt-2 border-t space-y-2">
        <div class="flex gap-2 items-center flex-wrap">
          <input id="cpConfirmUsername_${p.id}" placeholder="Nhập username nhân viên cần xác nhận..." class="border rounded p-1 text-xs flex-1 min-w-[160px]" data-op-input="renderCpEmployeeStageLookup" data-arg0="${p.id}">
          <button data-op="deleteCareerPath" data-arg0="${p.id}" class="text-red-500 font-bold hover:underline text-xs">Xóa Lộ Trình</button>
        </div>
        <div id="cpEmployeeStageBox_${p.id}"></div>
      </div>` : '';
    return `
      <div class="bg-white rounded border p-3">
        <div class="font-bold text-emerald-800">${escapeHtml(p.name)}${p.targetTitle ? ` <span class="text-xs text-gray-500 font-normal">(mục tiêu: ${escapeHtml(p.targetTitle)})</span>` : ''}</div>
        ${p.description ? `<div class="text-xs text-gray-600 mt-1">${escapeHtml(p.description)}</div>` : ''}
        <div class="text-xs text-gray-500 mt-2 space-y-0.5">${stagesSummaryHTML}</div>
        <div class="text-xs mt-2 space-y-0.5 border-t pt-2"><b>Tiến độ của bạn:</b>${myStatusHTML}</div>
        ${manageHTML}
      </div>`;
  }).join('');
}

// Khối tra cứu của quản lý (Đợt 7) — gõ username xong hiện NGAY cấp bậc hiện tại của đúng người đó kèm
// gợi ý % hoàn thành + 1 nút "Xác Nhận" DUY NHẤT scoped đúng cấp đó (không còn nút xác nhận chung cho cả
// lộ trình như trước) — badge % chỉ là GỢI Ý hiển thị, nút xác nhận LUÔN bấm được bất kể %, server mới
// là nơi chốt điều kiện (xem confirmCareerPathAction()/lib/recordActions.js).
function renderCpEmployeeStageLookup(pathId) {
  const path = DB.careerPaths.find(p => p.id === pathId);
  const box = document.getElementById(`cpEmployeeStageBox_${pathId}`);
  const usernameInput = document.getElementById(`cpConfirmUsername_${pathId}`);
  if (!path || !box || !usernameInput) return;
  const username = usernameInput.value.trim();
  if (!username) { box.innerHTML = ''; return; }
  const employee = DB.users.find(u => u.username === username);
  if (!employee) { box.innerHTML = `<div class="text-red-500 italic">Không tìm thấy nhân viên "${escapeHtml(username)}"</div>`; return; }
  const stage = findCareerPathCurrentStage(path, username);
  if (!stage) {
    box.innerHTML = `<div class="text-emerald-700 font-bold">✅ ${escapeHtml(employee.name)} đã được xác nhận hoàn thành toàn bộ lộ trình này.</div>`;
    return;
  }
  const suggest = stage.total > 0 && stage.done >= stage.total
    ? `<span class="text-emerald-600 font-bold ml-1">✅ Đủ điều kiện — chờ xác nhận</span>`
    : `<span class="text-gray-600 ml-1">${stage.done}/${stage.total} chương trình đã hoàn thành</span>`;
  box.innerHTML = `
    <div class="bg-emerald-50 border border-emerald-200 rounded p-2 flex items-center gap-2 flex-wrap">
      <div class="flex-1 min-w-[160px]">${escapeHtml(employee.name)} — Cấp ${stage.index + 1}: ${escapeHtml(stage.name)}${suggest}</div>
      <button data-op="confirmCareerPathAction" data-arg0="${pathId}" data-arg1="${stage.index}" class="bg-emerald-600 text-white px-2 py-1 rounded text-xs font-bold hover:bg-emerald-700 whitespace-nowrap">Xác Nhận Cấp ${stage.index + 1}</button>
    </div>`;
}

async function confirmCareerPathAction(pathId, stageIndex) {
  const usernameInput = document.getElementById(`cpConfirmUsername_${pathId}`);
  const username = (usernameInput?.value || '').trim();
  if (!username) return alert('Vui lòng nhập username nhân viên cần xác nhận!');
  let confirmation;
  try {
    const result = await callRecordAction('careerPaths', pathId, 'confirm', { username, stageIndex });
    confirmation = result.confirmation;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  DB.careerPathConfirmations.unshift(confirmation);
  logSystemAction('INTERNAL', 'CONFIRM_CAREER_PATH', `Xác nhận nhân viên [${username}] hoàn thành Cấp ${stageIndex + 1} của lộ trình [id ${pathId}]`, 'SUCCESS');
  alert(`✅ Đã xác nhận ${confirmation.name} hoàn thành Cấp ${stageIndex + 1}: ${confirmation.stageName}!`);
  renderCareerPaths();
}

function deleteCareerPath(id) {
  if (!confirm('Xóa lộ trình thăng tiến này?')) return;
  callRecordAction('careerPaths', id, 'delete', {}).then(() => {
    DB.careerPaths = DB.careerPaths.filter(p => p.id !== id);
    logSystemAction('INTERNAL', 'DELETE_CAREER_PATH', `Xóa lộ trình thăng tiến [id ${id}]`, 'SUCCESS');
    renderCareerPaths();
  }).catch(err => alert(`⛔ ${err.message}`));
}

// ---------- ĐÀO TẠO TÂN BINH (Đợt 6) ----------
// Hạn Giai đoạn 1 (Ngày 1-7)/2 (Ngày 8-21)/3 (mốc Ngày 59, không phải khoảng) tính SỐNG từ
// progress.startDate (đã snapshot lúc phân công — KHÔNG đọc lại user.startDate) mỗi lần render, cùng
// tinh thần "không lưu cái tính được" của sessionState/"Sắp hết hạn" tuyển dụng đã có sẵn trong app.
const ONBOARDING_STAGE1_DAYS = 7, ONBOARDING_STAGE2_DAYS = 21, ONBOARDING_STAGE3_DAYS = 59;
const ONBOARDING_DUE_SOON_DAYS = 2; // còn <= 2 ngày tới hạn -> "Sắp đến hạn"

function onboardingAddDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d;
}
function onboardingMilestoneStatus(deadline, isDone) {
  if (isDone) return { key: 'DONE', label: 'Hoàn thành' };
  const daysLeft = (deadline.getTime() - Date.now()) / 86400000;
  if (daysLeft < 0) return { key: 'OVERDUE', label: 'Quá hạn' };
  if (daysLeft <= ONBOARDING_DUE_SOON_DAYS) return { key: 'DUE_SOON', label: 'Sắp đến hạn' };
  return { key: 'NOT_DUE', label: 'Chưa đến hạn' };
}
// Trả về null nếu progress không có startDate hợp lệ (hồ sơ lẽ ra không thể tồn tại — server đã chặn
// tạo mới khi nhân viên chưa có startDate — nhưng vẫn phòng vệ ở đây cho chắc).
function computeOnboardingMilestones(progress) {
  if (!progress?.startDate) return null;
  const stage1Deadline = onboardingAddDays(progress.startDate, ONBOARDING_STAGE1_DAYS);
  const stage2Deadline = onboardingAddDays(progress.startDate, ONBOARDING_STAGE2_DAYS);
  const stage3Deadline = onboardingAddDays(progress.startDate, ONBOARDING_STAGE3_DAYS);
  return {
    stage1: { deadline: stage1Deadline, status: onboardingMilestoneStatus(stage1Deadline, progress.stage1Result != null) },
    stage2: { deadline: stage2Deadline, status: onboardingMilestoneStatus(stage2Deadline, progress.stage2Result != null) },
    stage3: { deadline: stage3Deadline, status: onboardingMilestoneStatus(stage3Deadline, progress.stage3Evaluation != null) }
  };
}
const ONBOARDING_STATUS_BADGE_CLASS = { OVERDUE: 'bg-red-100 text-red-700', DUE_SOON: 'bg-amber-100 text-amber-700', NOT_DUE: 'bg-gray-100 text-gray-600' };
// Badge hiển thị cho 1 giai đoạn (1/2/3) — nếu đã có kết quả thì ưu tiên hiện Đạt/Không đạt (màu rõ ràng
// hơn hẳn nhãn "Hoàn thành" trung tính), chưa có kết quả thì hiện nhãn hạn tính sống ở trên.
function onboardingStageBadgeHTML(stageNum, progress, milestones) {
  const resultField = stageNum === 3 ? 'stage3Evaluation' : `stage${stageNum}Result`;
  const result = progress[resultField];
  const m = milestones ? milestones[`stage${stageNum}`] : null;
  let resultHTML;
  // Đợt 8 — Giai đoạn 1/2 không còn Đạt/Không đạt cấp-cả-giai-đoạn (đó là chuyện của từng lớp/bài thi,
  // xem computeOnboardingStageProgress()) — chỉ còn 2 trạng thái: chưa/đã được Nhân Sự CONFIRMED. Giai
  // đoạn 3 giữ nguyên Đạt/Không đạt (đánh giá tự do, không đổi).
  if (stageNum !== 3 && result === 'CONFIRMED') resultHTML = `<span class="text-emerald-700 font-bold">✅ Đã xác nhận</span>`;
  else if (stageNum === 3 && result === 'PASSED') resultHTML = `<span class="text-emerald-700 font-bold">✅ Đạt</span>`;
  else if (stageNum === 3 && result === 'FAILED') resultHTML = `<span class="text-red-600 font-bold">❌ Không đạt</span>`;
  else {
    const cls = m ? (ONBOARDING_STATUS_BADGE_CLASS[m.status.key] || 'bg-gray-100 text-gray-600') : 'bg-gray-100 text-gray-600';
    resultHTML = `<span class="text-[11px] px-1.5 py-0.5 rounded font-bold ${cls}">${m ? m.status.label : ''}</span>`;
  }
  const dateLabel = m ? m.deadline.toLocaleDateString('vi-VN') : '';
  return `<div>${resultHTML}</div><div class="text-[10px] text-gray-400">Hạn: ${dateLabel}</div>`;
}

// ---- Quản Lý Danh Mục Lộ Trình (Khối 1) ----
let editingOnboardingPathId = null;

function populateOnboardingPathSelects() {
  const s1 = document.getElementById('opStage1RequiredCourseIds'); populateCpStageCourseSelectOptions(s1);
  const s2 = document.getElementById('opStage2RequiredCourseIds'); populateCpStageCourseSelectOptions(s2);

  const pathOpts = DB.onboardingPaths.slice().sort((a, b) => b.id - a.id)
    .map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  const oaSel = document.getElementById('oaPathId'); if (oaSel) oaSel.innerHTML = pathOpts || `<option value="" disabled>-- Chưa có lộ trình nào, tạo ở khối trên --</option>`;
}

async function submitOnboardingPath(e) {
  e.preventDefault();
  if (!canManageTrainingLocal(currentUser)) return alert('⛔ Bạn không có quyền quản lý lộ trình đào tạo tân binh!');
  const payload = {
    name: document.getElementById('opName').value.trim(),
    stage1RequiredCourseIds: [...document.getElementById('opStage1RequiredCourseIds').selectedOptions].map(o => Number(o.value)),
    stage2RequiredCourseIds: [...document.getElementById('opStage2RequiredCourseIds').selectedOptions].map(o => Number(o.value)),
    stage3Criteria: document.getElementById('opStage3Criteria').value.trim()
  };
  try {
    if (editingOnboardingPathId) {
      const result = await callRecordAction('onboardingPaths', editingOnboardingPathId, 'edit', payload);
      const idx = DB.onboardingPaths.findIndex(p => p.id === editingOnboardingPathId);
      if (idx !== -1) DB.onboardingPaths[idx] = result.item;
      logSystemAction('INTERNAL', 'EDIT_ONBOARDING_PATH', `Sửa lộ trình đào tạo tân binh [${result.item.name}]`, 'SUCCESS');
      alert('✅ Đã cập nhật lộ trình đào tạo tân binh!');
      cancelEditOnboardingPath();
    } else {
      const result = await callCreateAction('onboardingPaths', payload);
      DB.onboardingPaths.unshift(result.item);
      logSystemAction('INTERNAL', 'CREATE_ONBOARDING_PATH', `Tạo lộ trình đào tạo tân binh [${result.item.name}]`, 'SUCCESS');
      alert('✅ Đã tạo lộ trình đào tạo tân binh thành công!');
      e.target.reset();
    }
  } catch (err) { return alert(`⛔ ${err.message}`); }
  renderOnboardingLms();
}

function openEditOnboardingPath(id) {
  const path = DB.onboardingPaths.find(p => p.id === id);
  if (!path) return;
  editingOnboardingPathId = id;
  populateOnboardingPathSelects();
  document.getElementById('opName').value = path.name;
  [...document.getElementById('opStage1RequiredCourseIds').options].forEach(o => { o.selected = (path.stage1RequiredCourseIds || []).includes(Number(o.value)); });
  [...document.getElementById('opStage2RequiredCourseIds').options].forEach(o => { o.selected = (path.stage2RequiredCourseIds || []).includes(Number(o.value)); });
  document.getElementById('opStage3Criteria').value = path.stage3Criteria || '';
  document.getElementById('opSubmitBtn').innerText = 'Lưu Thay Đổi';
  document.getElementById('opCancelEditBtn').classList.remove('hidden');
  document.getElementById('onboardingPathForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function cancelEditOnboardingPath() {
  editingOnboardingPathId = null;
  document.getElementById('onboardingPathForm').reset();
  document.getElementById('opSubmitBtn').innerText = 'Tạo Lộ Trình';
  document.getElementById('opCancelEditBtn').classList.add('hidden');
}
function deleteOnboardingPath(id) {
  if (!confirm('Xóa lộ trình đào tạo tân binh này? Các phân công đã có cho nhân viên vẫn giữ nguyên dữ liệu (không bị xoá theo).')) return;
  callRecordAction('onboardingPaths', id, 'delete', {}).then(() => {
    DB.onboardingPaths = DB.onboardingPaths.filter(p => p.id !== id);
    logSystemAction('INTERNAL', 'DELETE_ONBOARDING_PATH', `Xóa lộ trình đào tạo tân binh [id ${id}]`, 'SUCCESS');
    renderOnboardingLms();
  }).catch(err => alert(`⛔ ${err.message}`));
}

function renderOnboardingPathsTable() {
  const list = DB.onboardingPaths.slice().sort((a, b) => b.id - a.id);
  document.getElementById('paginationContainer_onboardingPaths').innerHTML = buildPaginationBoxHTML('onboardingPaths', 'renderOnboardingPathsTable');
  const pageItems = paginateList('onboardingPaths', list, 'renderOnboardingPathsTable', 'lộ trình');
  const tbody = document.getElementById('onboardingPathsTableBody');
  if (!tbody) return;
  if (!pageItems.length) { tbody.innerHTML = `<tr><td colspan="5" class="text-center p-4 text-gray-400 italic">Chưa có lộ trình đào tạo tân binh nào.</td></tr>`; return; }
  const canManage = canManageTrainingLocal(currentUser);
  const courseNamesHTML = (courseIds) => (courseIds || []).map(id => {
    const c = DB.trainingCourses.find(x => x.id === id);
    return c ? escapeHtml(c.name) : `<span class="text-red-500 italic">(chương trình đã xoá)</span>`;
  }).join(', ') || `<span class="text-gray-400 italic">(chưa chọn)</span>`;
  tbody.innerHTML = pageItems.map(p => {
    const actions = canManage ? `
      <button data-op="openEditOnboardingPath" data-arg0="${p.id}" class="text-blue-600 font-bold hover:underline mr-2">Sửa</button>
      ${currentUser.perms?.admin ? `<button data-op="deleteOnboardingPath" data-arg0="${p.id}" class="text-red-500 font-bold hover:underline">Xóa</button>` : ''}` : '';
    return `<tr class="hover:bg-gray-50">
      <td class="border p-2 font-bold">${escapeHtml(p.name)}</td>
      <td class="border p-2">${courseNamesHTML(p.stage1RequiredCourseIds)}</td>
      <td class="border p-2">${courseNamesHTML(p.stage2RequiredCourseIds)}</td>
      <td class="border p-2 max-w-xs truncate" title="${escapeHtml(p.stage3Criteria || '')}">${escapeHtml(p.stage3Criteria || '(chưa nhập)')}</td>
      <td class="border p-2 text-center whitespace-nowrap">${actions}</td>
    </tr>`;
  }).join('');
}

// Đợt 8 — % hoàn thành chương trình bắt buộc của Giai đoạn 1/2 cho ĐÚNG 1 nhân viên (progress) trên 1
// lộ trình — cùng công thức "Đạt = có 1 trainingRegistrations PASSED ở 1 lớp thuộc chương trình CÓ gán
// bài test" như computeCareerPathStageStatuses() (mirror ĐÚNG luật gác ở confirmOnboardingStage(),
// lib/recordActions.js).
function computeOnboardingStageProgress(progress, path, stageNum) {
  const requiredCourseIds = Array.isArray(path?.[`stage${stageNum}RequiredCourseIds`]) ? path[`stage${stageNum}RequiredCourseIds`] : [];
  const done = requiredCourseIds.filter(courseId => DB.trainingRegistrations.some(r =>
    r.creator === progress.employeeUsername && r.result === 'PASSED' &&
    DB.trainingClasses.some(c => c.id === r.classId && c.courseId === courseId && c.testId != null))).length;
  return { total: requiredCourseIds.length, done };
}

// Ô "Xác Nhận" Giai đoạn 1/2 trong bảng Phân Công (Khối 2, chỉ Nhân Sự canManage nhìn thấy) — % gợi ý +
// 1 nút Xác Nhận LUÔN bấm được (server mới chốt điều kiện thật, xem confirmOnboardingStageAction()),
// rỗng nếu giai đoạn đã CONFIRMED hoặc đang bị khoá tuần tự (Giai đoạn 2 cần Giai đoạn 1 xong trước).
function onboardingStageConfirmCellHTML(p, path, stageNum, canManage) {
  if (!canManage) return '';
  if (p[`stage${stageNum}Result`] === 'CONFIRMED') return '';
  if (stageNum === 2 && p.stage1Result !== 'CONFIRMED') return '';
  const { done, total } = computeOnboardingStageProgress(p, path, stageNum);
  const suggest = total > 0 && done >= total ? ' <span class="text-emerald-600 font-bold">✅</span>' : '';
  return `<div class="mt-1"><span class="text-[10px] text-gray-500">${done}/${total} CT${suggest}</span><br><button data-op="confirmOnboardingStageAction" data-arg0="${p.id}" data-arg1="${stageNum}" class="mt-0.5 bg-emerald-600 text-white px-2 py-0.5 rounded text-[10px] font-bold hover:bg-emerald-700">Xác Nhận GĐ${stageNum}</button></div>`;
}

// ---- Phân Công (Khối 2) ----
let onboardingEmployeesCache = [];
function populateOnboardingEmployeesDatalist() {
  onboardingEmployeesCache = (DB.users || []).filter(u => u.active !== false);
  sddSetOptions('onboardingEmployeesDatalist', onboardingEmployeesCache.map(u => `${u.name} (${u.username})`));
}
// Cùng khuôn resolveUniformEmployeeInput() (đã có sẵn cho Đồng Phục) — khớp text "Tên (tài_khoản)" đang
// gõ với đúng 1 tài khoản còn hiệu lực -> ghi username vào ô ẩn.
function resolveOnboardingEmployeeInput() {
  const raw = document.getElementById('oaEmployeeInput').value;
  const m = raw.match(/\(([^()]+)\)\s*$/);
  const username = m ? m[1].trim() : '';
  const found = onboardingEmployeesCache.some(u => u.username === username);
  document.getElementById('oaEmployeeUsername').value = found ? username : '';
}

async function submitOnboardingAssignment() {
  if (!canManageTrainingLocal(currentUser)) return alert('⛔ Bạn không có quyền phân công lộ trình đào tạo tân binh!');
  const employeeUsername = document.getElementById('oaEmployeeUsername').value;
  if (!employeeUsername) return alert('Vui lòng gõ và chọn đúng 1 nhân viên từ danh sách gợi ý!');
  const pathId = Number(document.getElementById('oaPathId').value);
  if (!pathId) return alert('Vui lòng chọn lộ trình đào tạo tân binh!');
  let newProgress;
  try {
    const result = await callCreateAction('onboardingProgress', { employeeUsername, pathId });
    newProgress = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  DB.onboardingProgress.unshift(newProgress);
  logSystemAction('INTERNAL', 'ASSIGN_ONBOARDING', `Phân công lộ trình tân binh [${newProgress.pathName}] cho [${newProgress.employeeUsername}]`, 'SUCCESS');
  alert(`✅ Đã phân công lộ trình "${newProgress.pathName}" cho ${newProgress.employeeName}!`);
  document.getElementById('oaEmployeeInput').value = '';
  document.getElementById('oaEmployeeUsername').value = '';
  renderOnboardingLms();
}

function deleteOnboardingProgress(id) {
  if (!confirm('Xóa dòng phân công đào tạo tân binh này?')) return;
  callRecordAction('onboardingProgress', id, 'delete', {}).then(() => {
    DB.onboardingProgress = DB.onboardingProgress.filter(p => p.id !== id);
    logSystemAction('INTERNAL', 'DELETE_ONBOARDING_PROGRESS', `Xóa phân công đào tạo tân binh [id ${id}]`, 'SUCCESS');
    renderOnboardingLms();
  }).catch(err => alert(`⛔ ${err.message}`));
}

// Nhân Sự xác nhận hoàn thành Giai đoạn 1/2 (Đợt 8) — server chốt lại điều kiện (đủ chương trình bắt
// buộc đã Đạt qua lớp có bài test + gác tuần tự Giai đoạn 2 cần Giai đoạn 1), client chỉ gọi action.
async function confirmOnboardingStageAction(progressId, stage) {
  if (!confirm(`Xác nhận nhân viên đã hoàn thành Giai đoạn ${stage}?`)) return;
  let updated;
  try {
    const result = await callRecordAction('onboardingProgress', progressId, 'confirm-stage', { stage });
    updated = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.onboardingProgress.findIndex(p => p.id === progressId);
  if (idx !== -1) DB.onboardingProgress[idx] = updated;
  logSystemAction('INTERNAL', 'CONFIRM_ONBOARDING_STAGE', `Xác nhận hoàn thành Giai đoạn ${stage} đào tạo tân binh [${updated.employeeUsername}]`, 'SUCCESS');
  alert(`✅ Đã xác nhận hoàn thành Giai đoạn ${stage}!`);
  renderOnboardingLms();
}

function renderOnboardingProgressTable() {
  const list = DB.onboardingProgress.slice().sort((a, b) => b.id - a.id);
  document.getElementById('paginationContainer_onboardingProgress').innerHTML = buildPaginationBoxHTML('onboardingProgress', 'renderOnboardingProgressTable');
  const pageItems = paginateList('onboardingProgress', list, 'renderOnboardingProgressTable', 'phân công');
  const tbody = document.getElementById('onboardingProgressTableBody');
  if (!tbody) return;
  if (!pageItems.length) { tbody.innerHTML = `<tr><td colspan="8" class="text-center p-4 text-gray-400 italic">Chưa có nhân viên nào được phân công.</td></tr>`; return; }
  const canManage = canManageTrainingLocal(currentUser);
  tbody.innerHTML = pageItems.map(p => {
    const path = DB.onboardingPaths.find(x => x.id === p.pathId);
    const m = computeOnboardingMilestones(p);
    const canIssue = p.stage1Result === 'CONFIRMED' && p.stage2Result === 'CONFIRMED' && p.stage3Evaluation === 'PASSED';
    let certCell;
    if (p.certificateIssued) certCell = `<button data-op="downloadOnboardingCertificatePdf" data-arg0="${p.id}" class="text-indigo-600 font-bold hover:underline">⬇️ Tải Lại</button>`;
    else if (canIssue) certCell = `<button data-op="issueOnboardingCertificateAction" data-arg0="${p.id}" class="bg-emerald-600 text-white px-2 py-1 rounded font-bold hover:bg-emerald-700">🎓 Cấp Chứng Chỉ</button>`;
    else certCell = `<span class="text-gray-400 italic">Chưa đủ điều kiện</span>`;
    return `<tr class="hover:bg-gray-50">
      <td class="border p-2">${escapeHtml(p.employeeName)}<div class="text-gray-400">(${escapeHtml(p.employeeUsername)})</div></td>
      <td class="border p-2">${escapeHtml(p.pathName)}</td>
      <td class="border p-2">${p.startDate ? escapeHtml(new Date(p.startDate).toLocaleDateString('vi-VN')) : ''}</td>
      <td class="border p-2 text-center">${onboardingStageBadgeHTML(1, p, m)}${onboardingStageConfirmCellHTML(p, path, 1, canManage)}</td>
      <td class="border p-2 text-center">${onboardingStageBadgeHTML(2, p, m)}${onboardingStageConfirmCellHTML(p, path, 2, canManage)}</td>
      <td class="border p-2 text-center">${onboardingStageBadgeHTML(3, p, m)}</td>
      <td class="border p-2 text-center">${certCell}</td>
      <td class="border p-2 text-center">${currentUser.perms?.admin ? `<button data-op="deleteOnboardingProgress" data-arg0="${p.id}" class="text-red-500 font-bold hover:underline">Xóa</button>` : ''}</td>
    </tr>`;
  }).join('');
}

// ---- Lộ Trình Tân Binh Của Tôi (Khối 3) ----

// Đợt 8 — hiển thị danh sách CHƯƠNG TRÌNH HỌC bắt buộc của 1 giai đoạn cho nhân viên xem, kèm dấu đã Đạt
// hay chưa (dựa đúng công thức computeOnboardingStageProgress()) — thay hẳn khối tài liệu/nút vào làm
// bài test cũ (đã bỏ, xem giải thích ở computeOnboardingStageProgress()).
function onboardingStageCoursesHTML(path, stageNum) {
  const courseIds = Array.isArray(path?.[`stage${stageNum}RequiredCourseIds`]) ? path[`stage${stageNum}RequiredCourseIds`] : [];
  if (!courseIds.length) return '<div class="text-xs text-gray-400 italic">Chưa cấu hình chương trình.</div>';
  return courseIds.map(courseId => {
    const course = DB.trainingCourses.find(c => c.id === courseId);
    const passed = DB.trainingRegistrations.some(r => r.creator === currentUser.username && r.result === 'PASSED' &&
      DB.trainingClasses.some(c => c.id === r.classId && c.courseId === courseId && c.testId != null));
    return `<div class="text-xs flex items-center gap-1">${passed ? '✅' : '⬜'} ${course ? escapeHtml(course.name) : '<span class="text-red-500 italic">(chương trình đã xoá)</span>'}</div>`;
  }).join('');
}

function renderMyOnboardingCardHTML(p) {
  const path = DB.onboardingPaths.find(x => x.id === p.pathId);
  const m = computeOnboardingMilestones(p);
  const stage1Courses = onboardingStageCoursesHTML(path, 1);
  const stage2Courses = onboardingStageCoursesHTML(path, 2);
  const stageHint = `<div class="text-xs text-gray-500 italic">Đăng ký + học các lớp thuộc chương trình trên ở tab "Lớp Học" (lớp có bài test) — hoàn thành hết sẽ chờ Nhân Sự xác nhận.</div>`;

  const stage1Note = p.stage1Result === 'CONFIRMED'
    ? `<div class="text-xs text-emerald-700 font-bold">✅ Đã được Nhân Sự xác nhận hoàn thành</div>`
    : stageHint;
  const stage2Locked = p.stage1Result !== 'CONFIRMED';
  const stage2Note = p.stage2Result === 'CONFIRMED'
    ? `<div class="text-xs text-emerald-700 font-bold">✅ Đã được Nhân Sự xác nhận hoàn thành</div>`
    : stage2Locked
      ? `<div class="text-xs text-gray-400 italic">🔒 Cần hoàn thành Giai đoạn 1 trước</div>`
      : stageHint;

  const stage3HTML = p.stage3Evaluation != null
    ? `<div class="${p.stage3Evaluation === 'PASSED' ? 'text-emerald-700' : 'text-red-600'} font-bold text-xs">${p.stage3Evaluation === 'PASSED' ? '✅ Đạt' : '❌ Không đạt'} — đánh giá bởi ${escapeHtml(p.stage3EvaluatedByName || '')}</div>${p.stage3Note ? `<div class="text-xs text-gray-600 italic mt-1">"${escapeHtml(p.stage3Note)}"</div>` : ''}`
    : `<div class="text-xs text-gray-500 italic">Chờ quản lý trực tiếp đánh giá.</div>`;

  const overdueWarning = (m && (m.stage1.status.key === 'OVERDUE' || m.stage2.status.key === 'OVERDUE'))
    ? `<div class="bg-red-100 border border-red-300 text-red-700 text-xs font-bold rounded p-2">⚠️ Bạn đang trễ hạn 1 hoặc nhiều giai đoạn — vui lòng hoàn thành sớm nhất có thể!</div>` : '';

  const certHTML = p.certificateIssued
    ? `<button data-op="downloadOnboardingCertificatePdf" data-arg0="${p.id}" class="bg-amber-500 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-amber-600 flex-shrink-0">🏆 Tải Chứng Chỉ Hoàn Thành</button>`
    : '';

  return `<div class="bg-white rounded border p-3 space-y-3">
    <div class="flex justify-between items-start flex-wrap gap-2">
      <div>
        <div class="font-bold text-indigo-900">${escapeHtml(p.pathName)}</div>
        <div class="text-xs text-gray-500">Ngày vào làm: ${p.startDate ? escapeHtml(new Date(p.startDate).toLocaleDateString('vi-VN')) : ''}</div>
      </div>
      ${certHTML}
    </div>
    ${overdueWarning}
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div class="border rounded p-2 space-y-2">
        <div class="font-bold text-xs text-gray-700 flex justify-between items-center">Giai Đoạn 1 (Ngày 1-7) ${onboardingStageBadgeHTML(1, p, m)}</div>
        <div class="space-y-1">${stage1Courses}</div>
        <div>${stage1Note}</div>
      </div>
      <div class="border rounded p-2 space-y-2">
        <div class="font-bold text-xs text-gray-700 flex justify-between items-center">Giai Đoạn 2 (Ngày 8-21) ${onboardingStageBadgeHTML(2, p, m)}</div>
        <div class="space-y-1">${stage2Courses}</div>
        <div>${stage2Note}</div>
      </div>
      <div class="border rounded p-2 space-y-2">
        <div class="font-bold text-xs text-gray-700 flex justify-between items-center">Giai Đoạn 3 (đến Ngày 59) ${onboardingStageBadgeHTML(3, p, m)}</div>
        <div class="text-xs text-gray-600">${escapeHtml(path?.stage3Criteria || '')}</div>
        ${stage3HTML}
      </div>
    </div>
  </div>`;
}

function renderMyOnboarding() {
  const mine = DB.onboardingProgress.filter(p => p.employeeUsername === currentUser.username);
  const section = document.getElementById('myOnboardingSection');
  section.classList.toggle('hidden', mine.length === 0);
  if (!mine.length) return;
  document.getElementById('myOnboardingContainer').innerHTML = mine.map(renderMyOnboardingCardHTML).join('');
}

// ---- Đánh Giá Giai Đoạn 3 (Khối 4) ----
// Mirror ĐÚNG idiom uniformStoreManage/item.dept (lib/recordViewScope.js) — chỉ dùng để LỌC hiển thị ở
// client, chốt chặn thật sự vẫn ở server (evaluateOnboardingStage3(), lib/recordActions.js).
function canEvaluateOnboardingStage3Local(user, traineeUser) {
  if (user?.perms?.admin) return true;
  return !!(user?.perms?.onboardingEvaluate && traineeUser && traineeUser.dept === user.dept);
}

function renderOnboardingStage3Queue() {
  const canSeeSection = !!(currentUser.perms?.admin || currentUser.perms?.onboardingEvaluate);
  const section = document.getElementById('onboardingStage3Section');
  section.classList.toggle('hidden', !canSeeSection);
  if (!canSeeSection) return;
  const queue = DB.onboardingProgress.filter(p => {
    if (p.stage3Evaluation != null) return false;
    if (p.stage1Result !== 'CONFIRMED' || p.stage2Result !== 'CONFIRMED') return false;
    const traineeUser = DB.users.find(u => u.username === p.employeeUsername);
    return canEvaluateOnboardingStage3Local(currentUser, traineeUser);
  });
  const container = document.getElementById('onboardingStage3QueueContainer');
  if (!queue.length) { container.innerHTML = `<div class="text-xs text-gray-500 italic bg-white rounded border p-3">Không có nhân viên nào đang chờ bạn đánh giá Giai đoạn 3.</div>`; return; }
  container.innerHTML = queue.map(p => {
    const path = DB.onboardingPaths.find(x => x.id === p.pathId);
    return `<div class="bg-white rounded border p-3 space-y-2">
      <div class="font-bold text-gray-800">${escapeHtml(p.employeeName)} <span class="text-gray-400 font-normal">(${escapeHtml(p.employeeUsername)})</span> — ${escapeHtml(p.pathName)}</div>
      <div class="text-xs text-gray-600"><b>Tiêu chí đánh giá:</b> ${escapeHtml(path?.stage3Criteria || '(chưa nhập)')}</div>
      <textarea id="os3Note_${p.id}" placeholder="Ghi chú đánh giá (tuỳ chọn)..." class="w-full border p-1.5 rounded text-xs h-16"></textarea>
      <div class="flex gap-2">
        <button data-op="submitOnboardingStage3Evaluation" data-arg0="${p.id}" data-arg1="PASSED" class="bg-emerald-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-emerald-700">✅ Đạt</button>
        <button data-op="submitOnboardingStage3Evaluation" data-arg0="${p.id}" data-arg1="FAILED" class="bg-red-500 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-red-600">❌ Không Đạt</button>
      </div>
    </div>`;
  }).join('');
}

async function submitOnboardingStage3Evaluation(progressId, evaluation) {
  const note = document.getElementById(`os3Note_${progressId}`)?.value.trim() || '';
  if (!confirm(`Xác nhận đánh giá Giai đoạn 3: ${evaluation === 'PASSED' ? 'ĐẠT' : 'KHÔNG ĐẠT'}?`)) return;
  let updated;
  try {
    const result = await callRecordAction('onboardingProgress', progressId, 'evaluate-stage3', { evaluation, note });
    updated = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.onboardingProgress.findIndex(p => p.id === progressId);
  if (idx !== -1) DB.onboardingProgress[idx] = updated;
  logSystemAction('INTERNAL', 'EVALUATE_ONBOARDING_STAGE3', `Đánh giá Giai đoạn 3 đào tạo tân binh [${updated.employeeUsername}]: ${evaluation}`, 'SUCCESS');
  alert('✅ Đã ghi nhận đánh giá Giai đoạn 3!');
  renderOnboardingLms();
}

// ---- Cấp/Tải Chứng Chỉ Hoàn Thành ----
async function issueOnboardingCertificateAction(progressId) {
  if (!confirm('Cấp Chứng Chỉ Hoàn Thành Đào Tạo Tân Binh cho nhân viên này? (KHÔNG thể huỷ sau khi cấp)')) return;
  let updated;
  try {
    const result = await callRecordAction('onboardingProgress', progressId, 'issue-certificate', {});
    updated = result.item;
  } catch (err) { return alert(`⛔ ${err.message}`); }
  const idx = DB.onboardingProgress.findIndex(p => p.id === progressId);
  if (idx !== -1) DB.onboardingProgress[idx] = updated;
  logSystemAction('INTERNAL', 'ISSUE_ONBOARDING_CERT', `Cấp chứng chỉ hoàn thành đào tạo tân binh [${updated.employeeUsername}]`, 'SUCCESS');
  renderOnboardingLms();
  await downloadOnboardingCertificatePdf(progressId);
}

// PDF Chứng Chỉ Hoàn Thành — CÙNG kỹ thuật html2canvas+jsPDF với exportBudgetSummaryPdf() (xem baseline:
// đây là cơ chế PDF THẬT duy nhất của hệ thống, khác các "phiếu" HTML thuần dùng để in/tải ở module
// khác). Dựng lại HOÀN TOÀN từ dữ liệu progress hiện có mỗi lần bấm tải — KHÔNG lưu file PDF ở đâu cả,
// nên "Tải Lại" sau này luôn ra đúng 1 file giống hệt (chỉ phụ thuộc progress/path — 2 dữ liệu này không
// đổi sau khi đã cấp chứng chỉ vì issueOnboardingCertificate() chỉ cho cấp 1 lần).
const ONBOARDING_CERT_PAGE_W = 794;  // A4 @ 96dpi (px)
const ONBOARDING_CERT_PAGE_H = 1123;
async function downloadOnboardingCertificatePdf(progressId) {
  const p = DB.onboardingProgress.find(x => x.id === progressId);
  if (!p || !p.certificateIssued) return alert('⛔ Chứng chỉ chưa được cấp cho hồ sơ này.');
  try {
    await Promise.all([
      loadVendorScript('/vendor/html2canvas/html2canvas.min.js'),
      loadVendorScript('/vendor/jspdf/jspdf.umd.min.js')
    ]);
    const issuedDate = p.certificateIssuedAt ? new Date(p.certificateIssuedAt).toLocaleDateString('vi-VN') : new Date().toLocaleDateString('vi-VN');
    const stage = document.createElement('div');
    stage.style.cssText = `position:fixed;left:-10000px;top:0;width:${ONBOARDING_CERT_PAGE_W}px;height:${ONBOARDING_CERT_PAGE_H}px;background:#fff;color:#111;box-sizing:border-box;font-family:Arial,'Segoe UI',sans-serif;padding:70px 60px;text-align:center;border:10px double #92400e;`;
    stage.innerHTML = `
      <div style="font-size:14px;letter-spacing:3px;color:#6b7280;">HCRC WORKSPACE</div>
      <div style="font-size:26px;font-weight:bold;color:#92400e;margin-top:50px;">CHỨNG NHẬN HOÀN THÀNH ĐÀO TẠO TÂN BINH</div>
      <div style="font-size:14px;color:#374151;margin-top:50px;">Chứng nhận nhân viên</div>
      <div style="font-size:24px;font-weight:bold;color:#111827;margin-top:12px;">${escapeHtml(p.employeeName)}</div>
      <div style="font-size:13px;color:#6b7280;margin-top:4px;">(${escapeHtml(p.employeeUsername)})</div>
      <div style="font-size:14px;color:#374151;margin-top:30px;">đã hoàn thành lộ trình đào tạo tân binh</div>
      <div style="font-size:20px;font-weight:bold;color:#111827;margin-top:10px;">${escapeHtml(p.pathName)}</div>
      <div style="font-size:13px;color:#6b7280;margin-top:60px;">Ngày cấp: ${issuedDate}</div>
    `;
    document.body.appendChild(stage);
    const canvas = await window.html2canvas(stage, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false });
    stage.remove();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'px', format: [ONBOARDING_CERT_PAGE_W, ONBOARDING_CERT_PAGE_H], compress: true });
    doc.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, ONBOARDING_CERT_PAGE_W, ONBOARDING_CERT_PAGE_H);
    const safeName = (p.employeeName || 'NhanVien').replace(/[\\/:*?"<>|]+/g, '_');
    doc.save(`ChungChiTanBinh_${safeName}.pdf`);
  } catch (err) {
    alert('⛔ Không tạo được PDF: ' + err.message);
  }
}


function renderOnboardingLms() {
  populateOnboardingPathSelects();
  populateOnboardingEmployeesDatalist();
  renderOnboardingPathsTable();
  renderOnboardingProgressTable();
  renderMyOnboarding();
  renderOnboardingStage3Queue();
}
