// lib/recordActions.js — Bước 2b (phương án C bảo mật): server tự xác minh quyền SỬA/XÓA/GIAO hồ sơ
// đã tồn tại (Hợp đồng, Biên bản họp, Công việc) — trước đây các thao tác này chỉ được chặn bằng hàm
// JS thuần ở client (canEditMeetingMinutesRecord()/canDeleteTaskRecord()/so sánh c.creator...), sau đó
// ghi thẳng TOÀN BỘ mảng dữ liệu lên qua POST /api/data/:key — 1 request tự soạn bỏ qua UI vẫn sửa/xóa
// được hồ sơ của người khác vì server chưa từng xác minh lại gì ở mức từng bản ghi.
//
// Khác lib/createValidation.js (đều là {all,depts} cho 6 module), 3 module ở đây có hình dạng quyền
// khác nhau nên không gộp vào 1 engine chung được: Hợp đồng chỉ theo "người tạo hoặc admin"; Biên bản
// họp thêm cờ minutesEdit (toàn công ty, không theo phòng ban) cho SỬA — riêng XÓA là quyền tối cao,
// chỉ Admin; Công việc theo NGƯỜI (assignedBy/assignee), hoàn toàn không có khái niệm phòng ban.
const { HttpError } = require('./httpErrors');
const { scopeAllows, OFFICE_SUBTYPE_TO_PERM_FLAG, normalizeReportEntryPayload } = require('./createValidation');
const { validateRegistrationItems: validateVppRegItems } = require('./vppCatalog');

function nowVN() {
  return new Date().toLocaleString('vi-VN');
}

// ===================== HỢP ĐỒNG (sửa) =====================
// Khớp đúng danh sách field mà updateContractReq() ở index.html cho sửa — KHÔNG gồm code/creator/id
// (không đổi được), KHÔNG gồm customData (form sửa hợp đồng không thu thập lại).
const CONTRACT_EDITABLE_FIELDS = ['dept', 'type', 'title', 'partner', 'amount', 'startDate', 'endDate', 'content'];

function editContract(payload, user, contract) {
  // Khớp đúng luật cũ ở client (openEditContract/updateContractReq): CHỈ người tạo mới sửa được, kể
  // cả admin cũng không có ngoại lệ — không mở rộng quyền so với hành vi trước Bước 2b.
  if (contract.creator !== user.username) {
    throw new HttpError(403, 'Bạn chỉ có thể sửa hồ sơ hợp đồng do chính mình tạo!');
  }
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Thiếu dữ liệu cập nhật');

  const endDateChanged = typeof payload.endDate === 'string' && contract.endDate !== payload.endDate;
  for (const field of CONTRACT_EDITABLE_FIELDS) {
    if (payload[field] !== undefined) contract[field] = payload[field];
  }
  if (payload.fileName !== undefined) {
    contract.fileName = payload.fileName;
    contract.fileType = payload.fileType;
    contract.fileUrl = payload.fileUrl;
  }
  contract.lastEditedBy = user.username;
  contract.lastEditedAt = nowVN();
  // Đổi ngày hết hạn thì tính lại từ đầu các mốc đã nhắc, tránh bỏ sót/lặp mốc mới (khớp logic cũ).
  if (endDateChanged) contract.notifiedThresholds = [];
  return contract;
}

// Duyệt/từ chối hợp đồng GỐC hoặc phụ lục — GIỜ đi qua quy trình Phê Duyệt HĐ theo bước (xem
// lib/workflowEngine.js MODULE_CONFIGS.contracts + routes/workflow.js POST /api/workflow/contracts/:id/
// approve|reject), KHÔNG còn là 1 cờ quyền phẳng contractApprove nữa — bỏ hẳn canApproveContract()/
// approveContract()/rejectContract() ở đây (trước là flat-permission, không có khái niệm bước/phòng ban).

// Upload "Tài liệu ký" (bản cứng đã ký) + bấm nút "Thanh toán" — cùng phạm vi quyền với người được
// tạo/quản lý hợp đồng của phòng ban đó (contractCreate scope, khớp getScope() ở CREATE_MODULE_CONFIGS.
// contracts), không mở thêm quyền riêng cho 2 thao tác vận hành này.
function canManageContractPayment(user, contract) {
  return !!(user.perms?.admin || scopeAllows(user, user.perms?.contractCreate, contract.dept));
}

function uploadContractSignedFile(payload, user, contract) {
  if (contract.isAddendum) throw new HttpError(400, 'Phụ lục không có tệp tài liệu ký riêng');
  if (!canManageContractPayment(user, contract)) throw new HttpError(403, 'Bạn không có quyền tải lên tài liệu ký cho hợp đồng này');
  if (contract.approvalStatus !== 'APPROVED') throw new HttpError(409, 'Hợp đồng chưa được phê duyệt');
  if (contract.signedFileStatus === 'APPROVED') throw new HttpError(409, 'Tài liệu ký đã được phê duyệt, không thể tải lên lại');
  const { fileName, fileType, fileUrl, customData } = payload || {};
  if (!fileName || !fileUrl) throw new HttpError(400, 'Thiếu tệp tài liệu ký');
  contract.signedFileName = fileName;
  contract.signedFileType = fileType;
  contract.signedFileUrl = fileUrl;
  contract.signedCustomData = customData || {};
  contract.signedUploadedBy = user.username;
  contract.signedUploadedAt = nowVN();
  // Mỗi lần tải lên (mới hoặc tải lại sau khi bị từ chối) đều phải qua lại quy trình "Quản Lý HĐ" theo
  // phòng ban (module key ảo "contractsSignedFile", xem lib/workflowEngine.js) — KHÔNG snapshot lúc tải
  // lên (khác quy trình Phê Duyệt gốc), luôn tra cấu hình admin mới nhất mỗi lần duyệt, giống Xe/Mua
  // Bán/VPP. signedFileCurrentStep/signedFileHistory là cặp field currentStep/history RIÊNG của quy
  // trình này (contract.currentStep/history vẫn thuộc về quy trình Phê Duyệt gốc, không đụng tới).
  contract.signedFileStatus = 'PENDING';
  contract.signedFileCurrentStep = 1;
  contract.signedFileHistory = [];
  return contract;
}

// Sinh sẵn danh sách các đợt xác nhận thanh toán cho 1 đề nghị thanh toán — nếu nguồn có sẵn các đợt
// đã khai (paymentInstallments, chỉ Hợp đồng mới nhập ở form Phê duyệt) thì dùng nguyên, không thì mặc
// định 1 đợt duy nhất = toàn bộ giá trị (Mua Bán/Sửa Chữa/Đầu Tư không có form nhập nhiều đợt riêng).
function buildPaymentInstallments(sourceInstallments, totalAmount, fallbackDesc) {
  const list = Array.isArray(sourceInstallments) ? sourceInstallments : [];
  const base = list.length ? list : [{ description: fallbackDesc, amount: totalAmount, dueDate: '' }];
  return base.map(it => ({ description: it.description || fallbackDesc, amount: it.amount || 0, dueDate: it.dueDate || '', confirmed: false, confirmedAt: null, confirmedBy: null }));
}

// Chuyển hợp đồng sang "Chờ thanh toán" + trả về BẢN NHÁP đề nghị thanh toán (CHƯA lưu — route gọi
// createForCollection('paymentRequests', ...) ngay sau khi mutatorFn này chạy xong, cùng khuôn với
// assignMinutesTasks()/insertMinutesTasks() ở routes/records.js).
function startContractPayment(user, contract) {
  if (contract.isAddendum) throw new HttpError(400, 'Phụ lục không có luồng thanh toán riêng');
  if (!canManageContractPayment(user, contract)) throw new HttpError(403, 'Bạn không có quyền chuyển hợp đồng này sang thanh toán');
  if (!contract.signedFileUrl) throw new HttpError(409, 'Cần tải lên Tài liệu ký trước khi chuyển sang thanh toán');
  if (contract.signedFileStatus !== 'APPROVED') throw new HttpError(409, 'Tài liệu ký cần được phê duyệt trước khi chuyển sang thanh toán');
  if (contract.paymentStatus !== 'CHUA_THANH_TOAN') throw new HttpError(409, 'Hợp đồng không ở trạng thái chưa thanh toán');
  contract.paymentStatus = 'CHO_THANH_TOAN';
  return {
    sourceModule: 'CONTRACT', sourceId: contract.id, sourceCode: contract.code,
    dept: contract.dept, title: contract.title, amount: contract.amount,
    installments: buildPaymentInstallments(contract.paymentInstallments, contract.amount, 'Thanh toán toàn bộ giá trị hợp đồng'),
    status: 'PENDING',
    createdBy: user.username, createdByName: user.name, createdAt: nowVN()
  };
}

// Upload "Tài liệu ký" + bấm nút "Thanh toán" cho officeReqs (Mua Bán/Sửa Chữa/Đầu Tư, module "Tổng
// Hợp") — cùng khuôn với uploadContractSignedFile()/startContractPayment() ở trên, chỉ khác phạm vi
// quyền: officeCreate scope + đúng cờ theo subType (officeBuy/officeFix/officeInvest).
function canManageOfficePayment(user, item) {
  const flag = OFFICE_SUBTYPE_TO_PERM_FLAG[item.subType];
  return !!(user.perms?.admin || (scopeAllows(user, user.perms?.officeCreate, item.dept) && (!flag || user.perms?.[flag])));
}

function uploadOfficeSignedFile(payload, user, item) {
  if (!canManageOfficePayment(user, item)) throw new HttpError(403, 'Bạn không có quyền tải lên tài liệu ký cho đề xuất này');
  if (item.status !== 'APPROVED') throw new HttpError(409, 'Đề xuất chưa được phê duyệt xong');
  const { fileName, fileType, fileUrl } = payload || {};
  if (!fileName || !fileUrl) throw new HttpError(400, 'Thiếu tệp tài liệu ký');
  item.signedFileName = fileName;
  item.signedFileType = fileType;
  item.signedFileUrl = fileUrl;
  item.signedUploadedBy = user.username;
  item.signedUploadedAt = nowVN();
  return item;
}

function startOfficePayment(user, item) {
  if (!canManageOfficePayment(user, item)) throw new HttpError(403, 'Bạn không có quyền chuyển đề xuất này sang thanh toán');
  if (!item.signedFileUrl) throw new HttpError(409, 'Cần tải lên Tài liệu ký trước khi chuyển sang thanh toán');
  if (item.paymentStatus !== 'CHUA_THANH_TOAN') throw new HttpError(409, 'Đề xuất không ở trạng thái chưa thanh toán');
  item.paymentStatus = 'CHO_THANH_TOAN';
  return {
    sourceModule: item.subType, sourceId: item.id, sourceCode: item.code,
    dept: item.dept, title: item.title, amount: item.amount,
    installments: buildPaymentInstallments(null, item.amount, 'Thanh toán toàn bộ giá trị đề xuất'),
    status: 'PENDING',
    createdBy: user.username, createdByName: user.name, createdAt: nowVN()
  };
}

// ===================== THANH TOÁN (module "Tổng Hợp" > "Thanh toán") =====================
// Vòng đời: PENDING (sửa được) -> [NEED_INFO (sửa được)] -> APPROVED (xác nhận từng đợt) -> PAID
// (khoá cứng, không sửa/xoá/huỷ được — đúng yêu cầu nghiệp vụ). PAID ghi ngược paymentStatus =
// DA_THANH_TOAN về đúng bản ghi nguồn (Hợp đồng/officeReqs) nếu có sourceModule/sourceId — xem
// routes/records.js (2 lần khoá bản ghi tuần tự: paymentRequests rồi tới bản ghi nguồn).
const PAYMENT_EDITABLE_FIELDS = ['title', 'dept', 'amount', 'installments'];

function canManagePaymentRequests(user) {
  return !!(user.perms?.admin || user.perms?.paymentManage);
}

function editPaymentRequest(payload, user, pr) {
  if (!canManagePaymentRequests(user)) throw new HttpError(403, 'Bạn không có quyền sửa đề nghị thanh toán');
  if (pr.status !== 'PENDING' && pr.status !== 'NEED_INFO') throw new HttpError(409, 'Đề nghị thanh toán không còn ở trạng thái được sửa');
  for (const field of PAYMENT_EDITABLE_FIELDS) {
    if (payload[field] !== undefined) pr[field] = payload[field];
  }
  if (Array.isArray(pr.installments)) {
    pr.installments = pr.installments.map(it => ({
      description: (it?.description || '').trim(), amount: Number(it?.amount) || 0, dueDate: it?.dueDate || '',
      confirmed: false, confirmedAt: null, confirmedBy: null
    }));
    pr.amount = pr.installments.reduce((sum, it) => sum + it.amount, 0);
  }
  pr.status = 'PENDING';
  return pr;
}

function requestPaymentInfo(payload, user, pr) {
  if (!canManagePaymentRequests(user)) throw new HttpError(403, 'Bạn không có quyền yêu cầu bổ sung');
  if (pr.status !== 'PENDING') throw new HttpError(409, 'Đề nghị thanh toán không ở trạng thái chờ duyệt');
  const comment = (payload?.comment || '').trim();
  if (!comment) throw new HttpError(400, 'Vui lòng nhập nội dung cần bổ sung');
  pr.status = 'NEED_INFO';
  pr.infoRequestComment = comment;
  return pr;
}

function approvePaymentRequest(user, pr) {
  if (!canManagePaymentRequests(user)) throw new HttpError(403, 'Bạn không có quyền duyệt đề nghị thanh toán');
  if (pr.status !== 'PENDING' && pr.status !== 'NEED_INFO') throw new HttpError(409, 'Đề nghị thanh toán không ở trạng thái chờ duyệt');
  pr.status = 'APPROVED';
  pr.approvedBy = user.username;
  pr.approvedByName = user.name;
  pr.approvedAt = nowVN();
  return pr;
}

// Xác nhận đã thanh toán 1 đợt — đủ hết các đợt (không còn đợt nào chưa confirmed) thì tự chuyển PAID
// ("thanh toán thành công", khớp yêu cầu). Trả về cờ justCompleted để route biết có cần ghi ngược
// paymentStatus về bản ghi nguồn hay không.
function confirmPaymentInstallment(payload, user, pr) {
  if (!canManagePaymentRequests(user)) throw new HttpError(403, 'Bạn không có quyền xác nhận thanh toán');
  if (pr.status !== 'APPROVED') throw new HttpError(409, 'Đề nghị thanh toán chưa được duyệt hoặc đã hoàn tất');
  const idx = Number(payload?.index);
  if (!Array.isArray(pr.installments) || !pr.installments[idx]) throw new HttpError(400, 'Đợt thanh toán không hợp lệ');
  if (pr.installments[idx].confirmed) throw new HttpError(409, 'Đợt thanh toán này đã được xác nhận trước đó');
  pr.installments[idx].confirmed = true;
  pr.installments[idx].confirmedBy = user.username;
  pr.installments[idx].confirmedAt = nowVN();

  const justCompleted = pr.installments.every(it => it.confirmed);
  if (justCompleted) {
    pr.status = 'PAID';
    pr.paidAt = nowVN();
  }
  return { item: pr, justCompleted };
}

// Xoá đề nghị thanh toán giờ là "quyền tối cao" — chỉ Admin, không còn qua paymentManage (kế toán vẫn
// sửa/duyệt/yêu cầu bổ sung được như cũ, chỉ riêng XOÁ bị khoá lại theo đúng yêu cầu nghiệp vụ).
function assertCanDeletePaymentRequest(user, pr) {
  if (!user.perms?.admin) throw new HttpError(403, 'Chỉ Quản Trị Viên mới có quyền xoá đề nghị thanh toán');
  if (pr.status === 'PAID') throw new HttpError(409, 'Đề nghị thanh toán đã hoàn tất — không thể xoá');
}

// ===================== BIÊN BẢN HỌP (sửa/xóa) =====================
// minutesEdit là cờ toàn công ty (không phải {all,depts}) — khớp đúng canEditMeetingMinutesRecord()
// ở index.html. Xóa KHÔNG dùng cờ riêng nữa — xem canDeleteMinutes() bên dưới.
function canEditMinutes(user, minutes) {
  return !!(user.perms?.admin || user.perms?.minutesEdit || minutes.creator === user.username);
}
// Xoá biên bản họp giờ là "quyền tối cao" — chỉ Admin (bỏ minutesDelete + tự xoá bản của chính mình,
// khớp đúng yêu cầu khoá xoá cho người dùng thường). Sửa (canEditMinutes) không đổi.
function canDeleteMinutes(user) {
  return !!user.perms?.admin;
}

const MINUTES_EDITABLE_FIELDS = ['linkedMeetingId', 'title', 'time', 'location', 'chair', 'secretary', 'attendees', 'content', 'directives'];

function editMinutes(payload, user, minutes) {
  if (!canEditMinutes(user, minutes)) {
    throw new HttpError(403, 'Bạn không có quyền sửa biên bản họp này');
  }
  // Biên bản đã "Giao việc" (assignMinutesTasks(), xem dưới) bị khoá sửa với TẤT CẢ mọi người, kể cả
  // người tạo/minutesEdit — chỉ admin được sửa tiếp trong trường hợp khẩn cấp (đúng yêu cầu nghiệp vụ).
  if (minutes.tasksAssigned && !user.perms?.admin) {
    throw new HttpError(403, 'Biên bản này đã giao việc nên bị khoá, không thể sửa (chỉ Admin được sửa trong trường hợp khẩn cấp)');
  }
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Thiếu dữ liệu cập nhật');

  for (const field of MINUTES_EDITABLE_FIELDS) {
    if (payload[field] !== undefined) minutes[field] = payload[field];
  }
  minutes.lastEditedBy = user.username;
  minutes.lastEditedAt = nowVN();
  return minutes;
}

function assertCanDeleteMinutes(user, minutes) {
  if (!canDeleteMinutes(user, minutes)) {
    throw new HttpError(403, 'Bạn không có quyền xóa biên bản họp này');
  }
}

// ===================== BIÊN BẢN HỌP (tạo mới — Bước 4) =====================
// minutesCreate là cờ toàn công ty — khớp đúng canCreateMeetingMinutes() ở index.html.
function canCreateMinutes(user) {
  return !!(user.perms?.admin || user.perms?.minutesCreate);
}

function createMinutes(payload, user, existingCollection) {
  if (!canCreateMinutes(user)) {
    throw new HttpError(403, 'Bạn không có quyền lập biên bản họp');
  }
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Thiếu dữ liệu biên bản họp');
  if (payload.code) {
    const dup = (existingCollection || []).some(m => m.code === payload.code);
    if (dup) throw new HttpError(409, `Mã "${payload.code}" đã tồn tại`);
  }

  const record = { ...payload, id: Date.now() };
  record.creator = user.username;
  record.creatorName = user.name;
  return record;
}

// Sao y resolveDirectiveAttendee() ở index.html — dò 1 người trong "Thành phần tham dự" của CHÍNH bản
// ghi biên bản đã lưu theo attendeeId.
function resolveDirectiveAttendeeServer(attendeesList, attendeeId) {
  if (!attendeeId) return null;
  const a = (attendeesList || []).find(x => String(x.id) === String(attendeeId));
  if (!a || !(a.name || '').trim()) return null;
  return { name: a.name.trim(), email: (a.email || '').trim(), username: a.hasAccount === 'YES' ? (a.username || null) : null };
}

// Chuyển các dòng "chỉ đạo" đã gán người thực hiện thành Công việc mới — SERVER TỰ SUY LẠI từ chính
// bản ghi biên bản vừa lưu (minutes.attendees/minutes.directives), không tin danh sách việc do client
// tự gửi kèm. Gọi từ assignMinutesTasks() (nút "Giao việc" thủ công, xem dưới) — KHÔNG còn gọi tự
// động ngay khi lập/sửa biên bản như trước nữa (đúng yêu cầu nghiệp vụ: Giao việc là 1 bước riêng,
// người dùng chủ động bấm, sau đó biên bản mới bị khoá).
//
// LƯU Ý quyền hạn: bước này KHÔNG đòi canManageTasks (taskEdit) — quyền tạo việc ở đây tới từ việc
// user đã được phép tạo/sửa CHÍNH biên bản này (đã xác minh ở assignMinutesTasks() trước khi gọi hàm
// này). Tạo việc THỦ CÔNG qua modal Giao Việc (1 dòng chỉ đạo chưa gán người) là luồng khác, vẫn đòi
// canManageTasks — xem createTask() bên dưới.
//
// sourceDirectiveId: gắn lại ĐÚNG dòng chỉ đạo đã sinh ra Công việc này (d.id, hoặc chỉ số mảng cho
// biên bản cũ chưa có id) — để phía Xem chi tiết biên bản tra được đúng 1-1 trạng thái/lịch sử Công
// việc ứng với từng dòng chỉ đạo khi biên bản có nhiều hơn 1 chỉ đạo.
function buildTasksFromDirectives(minutes, user) {
  const created = [];
  (minutes.directives || []).forEach((d, i) => {
    if (!d.assignedToAttendeeId || d.taskCreated) return;
    const resolved = resolveDirectiveAttendeeServer(minutes.attendees, d.assignedToAttendeeId);
    if (!resolved) return;

    const collaboratorsResolved = (Array.isArray(d.collaboratorAttendeeIds) ? d.collaboratorAttendeeIds : [])
      .map(id => resolveDirectiveAttendeeServer(minutes.attendees, id))
      .filter(Boolean);

    // Công việc giao từ Biên bản họp được TÍNH TIẾN ĐỘ NGAY (status DOING, startedAt = lúc giao việc)
    // — không qua bước "Nhận Việc" như công việc giao trực tiếp (MANUAL). Chỉ đạo đã do người có thẩm
    // quyền (chủ trì/thư ký) ghi lại trong biên bản chính thức, coi như đã được giao xong ngay lúc lập.
    const startedAt = nowVN();
    const item = {
      id: Date.now() + i,
      title: `Chỉ đạo từ biên bản họp: ${minutes.title}`,
      description: d.content,
      deadline: d.deadline || '',
      assignedTo: resolved.username || '', assignedToName: resolved.name,
      externalAssignee: resolved.username ? null : { name: resolved.name, email: resolved.email },
      collaborators: collaboratorsResolved.filter(r => r.username).map(r => r.username),
      externalCollaborators: collaboratorsResolved.filter(r => !r.username).map(r => ({ name: r.name, email: r.email })),
      assignedBy: user.username, assignedByName: user.name,
      sourceType: 'MEETING_MINUTES', sourceCode: minutes.code, sourceDirectiveId: d.id != null ? d.id : i,
      status: 'DOING', startedAt,
      extensionCount: 0, lateCount: 0, pendingExtension: null, pendingCancellation: null,
      createdAt: nowVN(),
      history: [
        { action: 'CREATED', by: user.username, byName: user.name, time: nowVN() },
        { action: 'ACCEPTED', by: user.username, byName: user.name, time: startedAt, note: 'Tự động tính tiến độ ngay khi giao việc từ biên bản họp' }
      ]
    };
    d.taskCreated = true;
    // notify: thông tin CHỈ để trả về cho client gửi email — không thuộc bản ghi Công việc được lưu.
    created.push({
      item,
      notify: {
        assigneeEmail: resolved.email || '',
        collaboratorEmails: collaboratorsResolved.filter(r => r.email).map(r => ({ name: r.name, email: r.email }))
      }
    });
  });
  return created;
}

// "Giao việc" thủ công cho TOÀN BỘ chỉ đạo đã gán người trong 1 biên bản (nút ở danh sách biên bản
// họp) — thay cho cơ chế tự động cũ. Sau khi giao việc, biên bản chuyển sang tasksAssigned=true, bị
// editMinutes() ở trên khoá sửa (trừ admin khẩn cấp). Dùng lại đúng quyền sửa biên bản (canEditMinutes)
// làm điều kiện, không đòi canManageTasks — khớp lý do đã nêu ở buildTasksFromDirectives().
function assignMinutesTasks(user, minutes) {
  if (!canEditMinutes(user, minutes)) {
    throw new HttpError(403, 'Bạn không có quyền giao việc cho biên bản họp này');
  }
  if (minutes.tasksAssigned) {
    throw new HttpError(409, 'Biên bản này đã được giao việc rồi');
  }
  const created = buildTasksFromDirectives(minutes, user);
  if (created.length === 0) {
    throw new HttpError(400, 'Không có chỉ đạo nào đã gán người thực hiện để giao việc');
  }
  minutes.tasksAssigned = true;
  minutes.tasksAssignedBy = user.username;
  minutes.tasksAssignedByName = user.name;
  minutes.tasksAssignedAt = nowVN();
  return created;
}

// ===================== CÔNG VIỆC (tự động tạo khi Tờ trình được phê duyệt hoàn tất — Bước 6b) =====
// Khớp đúng logic trước đây nằm ở client (processSubmission() trong index.html): khi bước phê duyệt
// CUỐI CÙNG của 1 tờ trình có kèm ý kiến chỉ đạo (comment), tự tạo 1 Công việc theo dõi — CHƯA gán
// người nhận (người duyệt cuối/admin sẽ gán sau trong module Công việc). Trước đây client tự dựng
// object này rồi ghi thẳng qua POST /api/data/tasks (route generic, không xác minh gì) — cùng dạng lỗ
// hổng đã vá ở các module khác (client tự soạn assignedBy/id...). Chuyển vào server, gọi ngay sau khi
// applyWorkflowAction() xác nhận transition.type === 'COMPLETED' (xem routes/workflow.js).
function buildTaskFromSubmissionComment(sub, user, comment) {
  return {
    id: Date.now(),
    title: `Thực hiện theo chỉ đạo: ${sub.title}`,
    description: comment,
    deadline: '',
    assignedTo: '', assignedToName: '',
    assignedBy: user.username, assignedByName: user.name,
    sourceType: 'SUBMISSION', sourceCode: sub.code,
    status: 'TODO',
    extensionCount: 0, lateCount: 0, pendingExtension: null, pendingCancellation: null,
    createdAt: nowVN(),
    history: [{ action: 'CREATED', by: user.username, byName: user.name, time: nowVN() }]
  };
}

// ===================== TRUYỀN THÔNG NỘI BỘ (tương tác — Bước 6j) =====================
// Xem/tương tác (đánh dấu đã đọc, thích, bình luận, đăng ký đào tạo) mở cho MỌI người dùng đã đăng
// nhập — khớp đúng canCreateInternalPost() ở index.html (chỉ ĐĂNG bài mới cần quyền riêng theo type,
// tương tác với bài đã đăng thì ai cũng được, không cần kiểm tra quyền gì thêm ở đây ngoài đã đăng
// nhập, đã có sẵn ở requireAuth gắn trên toàn bộ router). Trước đây 5 hành động này ghi thẳng TOÀN BỘ
// mảng internalPosts qua POST /api/data/internalPosts (route generic, không xác minh gì) — 1 request tự
// soạn bỏ qua UI vẫn có thể giả mạo bình luận/lượt thích/đăng ký của người khác vì server chưa từng
// xác minh lại danh tính. Server giờ luôn dùng danh tính TỪ PHIÊN ĐĂNG NHẬP (user.username/name),
// không tin bất kỳ giá trị nào client tự gửi.
function markInternalPostRead(user, post) {
  if (!Array.isArray(post.readBy)) post.readBy = [];
  if (!post.readBy.includes(user.username)) post.readBy.push(user.username);
  return post;
}

function toggleInternalPostLike(user, post) {
  if (!Array.isArray(post.likes)) post.likes = [];
  const idx = post.likes.indexOf(user.username);
  if (idx === -1) post.likes.push(user.username);
  else post.likes.splice(idx, 1);
  return post;
}

function addInternalPostComment(payload, user, post) {
  const content = (payload?.content || '').trim();
  if (!content) throw new HttpError(400, 'Vui lòng nhập nội dung bình luận');
  if (!Array.isArray(post.comments)) post.comments = [];
  post.comments.push({ id: Date.now(), username: user.username, name: user.name, content, time: nowVN() });
  return post;
}

// Khớp đúng registerForTraining() ở index.html: đã đăng ký rồi thì client tự bỏ qua từ trước khi gọi
// tới đây (không coi là lỗi) — server vẫn tự kiểm tra lại phòng khi dữ liệu client cũ/lệch (idempotent,
// không throw), chỉ chặn thật khi ĐÃ ĐỦ số lượng.
function registerInternalPostTraining(user, post) {
  if (post.type !== 'TRAINING' || !post.training) throw new HttpError(400, 'Bài đăng không phải khóa đào tạo');
  if (!Array.isArray(post.training.registeredUsers)) post.training.registeredUsers = [];
  if (post.training.registeredUsers.includes(user.username)) return post;
  if (post.training.capacity > 0 && post.training.registeredUsers.length >= post.training.capacity) {
    throw new HttpError(409, 'Khóa đào tạo đã đủ số lượng đăng ký!');
  }
  post.training.registeredUsers.push(user.username);
  return post;
}

function unregisterInternalPostTraining(user, post) {
  if (post.type !== 'TRAINING' || !post.training) throw new HttpError(400, 'Bài đăng không phải khóa đào tạo');
  post.training.registeredUsers = (post.training.registeredUsers || []).filter(u => u !== user.username);
  return post;
}

// Duyệt/từ chối bài "Góc chia sẻ" (status PENDING gán sẵn khi tạo — xem lib/createValidation.js) —
// cờ toàn công ty internalPostApprove, khớp đúng hình dạng meetingApprove (routes/meetingActions.js),
// không theo phòng ban. Từ chối bắt buộc nhập lý do (khớp pattern Văn Phòng/Tài liệu).
function canApproveInternalPost(user) {
  return !!(user.perms?.admin || user.perms?.internalPostApprove);
}

function approveInternalPost(user, post) {
  if (!canApproveInternalPost(user)) throw new HttpError(403, 'Bạn không có quyền phê duyệt bài đăng này');
  if (post.status !== 'PENDING') throw new HttpError(409, 'Bài đăng không ở trạng thái chờ duyệt');
  post.status = 'APPROVED';
  post.approvedBy = user.username;
  post.approvedByName = user.name;
  post.approvedAt = nowVN();
  return post;
}

function rejectInternalPost(payload, user, post) {
  if (!canApproveInternalPost(user)) throw new HttpError(403, 'Bạn không có quyền từ chối bài đăng này');
  if (post.status !== 'PENDING') throw new HttpError(409, 'Bài đăng không ở trạng thái chờ duyệt');
  const reason = (payload?.reason || '').trim();
  if (!reason) throw new HttpError(400, 'Vui lòng nhập lý do từ chối');
  post.status = 'REJECTED';
  post.rejectedBy = user.username;
  post.rejectedByName = user.name;
  post.rejectedAt = nowVN();
  post.rejectReason = reason;
  return post;
}

// ===================== CÔNG VIỆC (sửa/giao/xóa) =====================
// canManageTasks (sửa) là cờ toàn công ty (admin||taskEdit) — quyền sửa BẤT KỲ công việc nào.
// Gán người nhận thì hẹp hơn: chỉ admin hoặc CHÍNH người đã giao việc đó (assignedBy) — khớp đúng
// 2 nhánh trong confirmCreateTask() ở index.html (không dùng chung 1 điều kiện).
function canManageTasks(user) {
  return !!(user.perms?.admin || user.perms?.taskEdit);
}
function canDeleteTaskPerm(user) {
  return !!(user.perms?.admin || user.perms?.taskDelete);
}
function canAssignSpecificTask(user, task) {
  return !!(user.perms?.admin || task.assignedBy === user.username);
}

function resolveAssigneeName(usersList, username) {
  const u = (usersList || []).find(x => x.username === username);
  return u ? u.name : username;
}

// Công việc tới từ Biên bản họp/Văn bản trình bỏ qua bước "Nhận Việc" — tính tiến độ ngay lúc
// giao/gán, khớp yêu cầu nghiệp vụ (chỉ đạo chính thức coi như đã được giao xong, không cần người
// nhận xác nhận lại). Việc giao trực tiếp (MANUAL) không đi qua assignTask() (đã có assignedTo ngay
// lúc tạo, xem createTask()) nên không bị ảnh hưởng — vẫn giữ TODO + Nhận Việc như cũ.
function shouldSkipAcceptStep(task) {
  return task.sourceType === 'MEETING_MINUTES' || task.sourceType === 'SUBMISSION';
}

// Gán "người nhận" cho 1 Công việc CHƯA có người nhận (tự động sinh từ ý kiến chỉ đạo cuối cùng của
// Văn bản trình — xem buildTaskFromSubmissionComment()). payload.assignedTo có thể là 1 username hoặc
// mảng nhiều username — Văn bản trình chỉ đạo có thể giao cho NHIỀU người thực hiện cùng lúc, mỗi
// người 1 bản ghi Công việc riêng để theo dõi tiến độ độc lập (không dùng chung 1 "assignedTo" mảng vì
// toàn bộ hệ thống — lọc/thống kê/Nhận việc/Cập nhật tiến độ — đều giả định assignedTo là 1 người).
// Người ĐẦU TIÊN trong danh sách được gán thẳng vào bản ghi hiện có (task tham số); những người còn
// lại trả về dưới dạng "extraTasks" (bản sao cùng nội dung, KHÁC id) để route (routes/records.js) tự
// insertTask() sau khi khoá bản ghi gốc đã nhả — cùng khuôn "mutator trả draft phụ, route mới ghi" đã
// dùng cho paymentRequests (xem startContractPayment()).
function assignTask(payload, user, task, usersList) {
  if (!canAssignSpecificTask(user, task)) {
    throw new HttpError(403, 'Bạn không có quyền gán người nhận cho công việc này');
  }
  const rawAssignees = Array.isArray(payload?.assignedTo) ? payload.assignedTo : [payload?.assignedTo];
  const assignees = [...new Set(rawAssignees.filter(u => typeof u === 'string' && u.trim()))];
  if (assignees.length === 0) {
    throw new HttpError(400, 'Thiếu người nhận việc');
  }
  const deadline = payload.deadline || '';
  const collaborators = Array.isArray(payload.collaborators) ? payload.collaborators : [];
  const skipAccept = shouldSkipAcceptStep(task);
  const startedAt = skipAccept ? nowVN() : null;

  const [firstAssignee, ...restAssignees] = assignees;
  task.assignedTo = firstAssignee;
  task.assignedToName = resolveAssigneeName(usersList, firstAssignee);
  task.deadline = deadline;
  task.collaborators = collaborators;
  task.history = Array.isArray(task.history) ? task.history : [];
  task.history.push({ action: 'ASSIGNED', by: user.username, byName: user.name, time: nowVN() });
  if (skipAccept) {
    task.status = 'DOING';
    task.startedAt = startedAt;
    task.history.push({ action: 'ACCEPTED', by: user.username, byName: user.name, time: startedAt, note: 'Tự động tính tiến độ ngay khi gán người nhận' });
  }

  const extraTasks = restAssignees.map((username, i) => {
    const cloneStartedAt = skipAccept ? nowVN() : null;
    const cloneHistory = [
      { action: 'CREATED', by: user.username, byName: user.name, time: nowVN() },
      { action: 'ASSIGNED', by: user.username, byName: user.name, time: nowVN() }
    ];
    if (skipAccept) cloneHistory.push({ action: 'ACCEPTED', by: user.username, byName: user.name, time: cloneStartedAt, note: 'Tự động tính tiến độ ngay khi gán người nhận' });
    return {
      id: Date.now() + i + 1,
      title: task.title,
      description: task.description,
      deadline,
      assignedTo: username, assignedToName: resolveAssigneeName(usersList, username),
      externalAssignee: null,
      collaborators, externalCollaborators: [],
      assignedBy: user.username, assignedByName: user.name,
      sourceType: task.sourceType, sourceCode: task.sourceCode, sourceDirectiveId: task.sourceDirectiveId,
      status: skipAccept ? 'DOING' : 'TODO', startedAt: cloneStartedAt,
      extensionCount: 0, lateCount: 0, pendingExtension: null, pendingCancellation: null,
      createdAt: nowVN(),
      history: cloneHistory
    };
  });

  return { item: task, extraTasks };
}

function editTask(payload, user, task, usersList) {
  if (!canManageTasks(user)) {
    throw new HttpError(403, 'Bạn không có quyền sửa công việc');
  }
  if (!payload || typeof payload !== 'object' || !payload.title) {
    throw new HttpError(400, 'Thiếu tiêu đề công việc');
  }
  if (!payload.assignedTo) throw new HttpError(400, 'Thiếu người nhận việc');

  task.title = payload.title;
  task.description = payload.description || '';
  task.deadline = payload.deadline || '';
  task.assignedTo = payload.assignedTo;
  task.assignedToName = resolveAssigneeName(usersList, payload.assignedTo);
  task.collaborators = Array.isArray(payload.collaborators) ? payload.collaborators : [];
  task.history = Array.isArray(task.history) ? task.history : [];
  task.history.push({ action: 'EDITED', by: user.username, byName: user.name, time: nowVN() });
  return task;
}

function assertCanDeleteTask(user) {
  if (!canDeleteTaskPerm(user)) {
    throw new HttpError(403, 'Bạn không có quyền xóa công việc');
  }
}

// Giao việc THỦ CÔNG qua modal (khác việc tự động sinh từ chỉ đạo biên bản — xem
// buildTasksFromDirectives() ở trên, không đòi canManageTasks vì quyền hạn ở đó tới từ việc được phép
// tạo/sửa biên bản, không phải quyền quản lý việc chung).
function createTask(payload, user, usersList) {
  if (!canManageTasks(user)) {
    throw new HttpError(403, 'Bạn không có quyền tạo công việc mới');
  }
  if (!payload || typeof payload !== 'object' || !payload.title) {
    throw new HttpError(400, 'Thiếu tiêu đề công việc');
  }
  if (!payload.assignedTo) throw new HttpError(400, 'Thiếu người nhận việc');

  const record = { ...payload, id: Date.now() };
  record.assignedToName = resolveAssigneeName(usersList, payload.assignedTo);
  record.assignedBy = user.username;
  record.assignedByName = user.name;
  record.history = [{ action: 'CREATED', by: user.username, byName: user.name, time: nowVN() }];
  return record;
}

// ===================== CÔNG VIỆC (Bước 3 — nhận việc/phối hợp/trạng thái/gia hạn/huỷ) =====================
// 10 hàm client cũ (acceptTask/acceptTaskOnBehalf/confirmCollaboratorParticipation[OnBehalf]/
// updateTaskStatus/confirmRequestExtension/approveExtension/rejectExtension/confirmCancelTask/
// approveCancellation/rejectCancellation) chỉ được chặn bằng hàm JS thuần ở client, y hệt dạng lỗ hổng
// đã vá ở phần sửa/giao/xóa phía trên. Gộp lại còn 5 hàm + 1 engine dùng chung (không phải 10 hàm rời):
//   - acceptTask(): gộp acceptTask + acceptTaskOnBehalf (khác gate + nội dung ghi chú)
//   - confirmCollaboratorParticipation(): gộp bản thân + OnBehalf
//   - updateTaskStatusAction(), requestExtension(), cancelOrRequestCancelTask(): không có cặp để gộp,
//     giữ riêng
//   - resolvePendingTaskAction(): 1 engine dùng chung cho approve/reject của CẢ gia hạn lẫn huỷ việc —
//     2 luồng đó giống hệt nhau ở bước duyệt/từ chối (khác nhau ở request), xem PENDING_TASK_CONFIGS.
//
// LƯU Ý: 1 số gate trước đây chỉ nằm ở hàm MỞ MODAL (openExtensionRequestModal/openCancelTaskModal),
// còn hàm submit thật (confirmRequestExtension/confirmCancelTask) lại KHÔNG tự kiểm tra lại — cùng dạng
// lỗ hổng hệt các bản vá trước (gate chỉ ở client, hàm ghi dữ liệu không xác minh lại). Ở đây xác minh
// LUÔN đúng gate đã ghi trong comment/hành vi modal gốc — không phải đổi nghiệp vụ, mà vá đúng cùng
// dạng lỗ hổng cho nhất quán với các module khác.

function acceptTask(payload, user, task) {
  const onBehalf = !!payload?.onBehalf;
  if (onBehalf) {
    if (!task.externalAssignee) {
      throw new HttpError(400, 'Công việc này có người thực hiện là tài khoản hệ thống, họ cần tự bấm Nhận việc');
    }
    if (!(user.perms?.admin || task.assignedBy === user.username)) {
      throw new HttpError(403, 'Chỉ người giao việc mới có thể xác nhận thay!');
    }
  } else if (task.assignedTo !== user.username) {
    throw new HttpError(403, 'Chỉ người được giao việc mới có thể Nhận việc!');
  }
  if (task.status !== 'TODO') throw new HttpError(409, 'Công việc này đã được nhận/xử lý rồi');

  task.status = 'DOING';
  task.startedAt = nowVN();
  const note = onBehalf ? `Xác nhận thay cho ${task.externalAssignee.name} (ngoài hệ thống)` : 'Đã nhận việc và bắt đầu thực hiện';
  task.history = Array.isArray(task.history) ? task.history : [];
  task.history.push({ action: 'ACCEPTED', by: user.username, byName: user.name, time: task.startedAt, note });
  return task;
}

function confirmCollaboratorParticipation(payload, user, task) {
  const externalName = payload?.externalName;
  task.collaboratorAccepts = Array.isArray(task.collaboratorAccepts) ? task.collaboratorAccepts : [];
  task.history = Array.isArray(task.history) ? task.history : [];

  if (externalName) {
    if (!(user.perms?.admin || task.assignedBy === user.username)) {
      throw new HttpError(403, 'Chỉ người giao việc mới có thể xác nhận thay!');
    }
    if (task.collaboratorAccepts.some(c => !c.username && c.name === externalName)) {
      throw new HttpError(409, 'Người này đã được xác nhận tham gia rồi');
    }
    task.collaboratorAccepts.push({ username: null, name: externalName, acceptedAt: nowVN() });
    task.history.push({ action: 'COLLABORATOR_CONFIRMED', by: user.username, byName: user.name, time: nowVN(), note: `Xác nhận tham gia thay cho ${externalName} (ngoài hệ thống)` });
  } else {
    if (!(task.collaborators || []).includes(user.username)) {
      throw new HttpError(403, 'Bạn không phải người phối hợp của công việc này!');
    }
    if (task.collaboratorAccepts.some(c => c.username === user.username)) {
      throw new HttpError(409, 'Bạn đã xác nhận tham gia công việc này rồi');
    }
    task.collaboratorAccepts.push({ username: user.username, name: user.name, acceptedAt: nowVN() });
    task.history.push({ action: 'COLLABORATOR_CONFIRMED', by: user.username, byName: user.name, time: nowVN(), note: 'Xác nhận tham gia phối hợp' });
  }
  return task;
}

// ===================== CÔNG VIỆC NHỎ (subtask) — người nhận việc tự chia nhỏ việc mình đang làm =====
// Tạo/đánh dấu hoàn thành/xoá công việc nhỏ ngay trong "Cập Nhật Tiến Độ" — mỗi subtask có hạn hoàn
// thành riêng (dueDate) nhưng KHÔNG được vượt quá hạn hoàn thành của việc gốc (task.deadline), đúng yêu
// cầu "tổng các công việc không lớn hơn thời hạn được giao việc ban đầu". Chỉ CHÍNH người nhận việc
// (hoặc admin) mới được thao tác — không phải người giao việc/phối hợp.
function canManageSubtasks(user, task) {
  return !!(user.perms?.admin || task.assignedTo === user.username);
}

function addSubtask(payload, user, task) {
  if (!canManageSubtasks(user, task)) {
    throw new HttpError(403, 'Chỉ người nhận việc mới có thể tạo công việc nhỏ');
  }
  if (task.status !== 'DOING') {
    throw new HttpError(409, 'Chỉ tạo được công việc nhỏ khi việc chính đang thực hiện');
  }
  const title = (payload?.title || '').trim();
  const dueDate = (payload?.dueDate || '').trim();
  if (!title) throw new HttpError(400, 'Thiếu tên công việc nhỏ');
  if (!dueDate) throw new HttpError(400, 'Thiếu hạn hoàn thành công việc nhỏ');
  if (task.deadline && dueDate > task.deadline) {
    throw new HttpError(400, `Hạn công việc nhỏ không được vượt quá hạn hoàn thành của việc chính (${task.deadline})`);
  }

  task.subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  task.subtasks.push({ id: Date.now(), title, dueDate, done: false, createdAt: nowVN() });
  task.history = Array.isArray(task.history) ? task.history : [];
  task.history.push({ action: 'SUBTASK_ADDED', by: user.username, byName: user.name, time: nowVN(), note: `Tạo công việc nhỏ "${title}" (hạn ${dueDate})` });
  return task;
}

function toggleSubtask(payload, user, task) {
  if (!canManageSubtasks(user, task)) {
    throw new HttpError(403, 'Chỉ người nhận việc mới có thể cập nhật công việc nhỏ');
  }
  const subtaskId = Number(payload?.subtaskId);
  const sub = (task.subtasks || []).find(s => s.id === subtaskId);
  if (!sub) throw new HttpError(404, 'Không tìm thấy công việc nhỏ');
  sub.done = !sub.done;
  sub.doneAt = sub.done ? nowVN() : null;
  task.history = Array.isArray(task.history) ? task.history : [];
  task.history.push({ action: 'SUBTASK_TOGGLED', by: user.username, byName: user.name, time: nowVN(), note: `${sub.done ? 'Hoàn thành' : 'Mở lại'} công việc nhỏ "${sub.title}"` });
  return task;
}

function deleteSubtask(payload, user, task) {
  if (!canManageSubtasks(user, task)) {
    throw new HttpError(403, 'Chỉ người nhận việc mới có thể xoá công việc nhỏ');
  }
  const subtaskId = Number(payload?.subtaskId);
  const idx = (task.subtasks || []).findIndex(s => s.id === subtaskId);
  if (idx === -1) throw new HttpError(404, 'Không tìm thấy công việc nhỏ');
  const [removed] = task.subtasks.splice(idx, 1);
  task.history = Array.isArray(task.history) ? task.history : [];
  task.history.push({ action: 'SUBTASK_DELETED', by: user.username, byName: user.name, time: nowVN(), note: `Xoá công việc nhỏ "${removed.title}"` });
  return task;
}

function updateTaskStatusAction(payload, user, task) {
  if (task.assignedTo !== user.username && task.assignedBy !== user.username && !user.perms?.admin) {
    throw new HttpError(403, 'Bạn không có quyền cập nhật công việc này!');
  }
  const newStatus = payload?.newStatus;
  if (!newStatus) throw new HttpError(400, 'Thiếu trạng thái mới');
  if (newStatus === 'DONE' && task.pendingExtension) {
    throw new HttpError(409, 'Công việc đang có 1 yêu cầu gia hạn chờ duyệt. Vui lòng Đồng ý hoặc Từ chối yêu cầu đó trước khi đóng công việc.');
  }
  if (newStatus === 'DONE' && task.pendingCancellation) {
    throw new HttpError(409, 'Công việc đang có 1 yêu cầu huỷ chờ duyệt. Vui lòng Đồng ý hoặc Từ chối yêu cầu đó trước khi đóng công việc.');
  }
  task.status = newStatus;
  task.history = Array.isArray(task.history) ? task.history : [];
  task.history.push({ action: `STATUS_${newStatus}`, by: user.username, byName: user.name, time: nowVN(), note: payload?.note || '' });
  return task;
}

function requestExtension(payload, user, task) {
  if (!(task.assignedTo === user.username || user.perms?.admin)) {
    throw new HttpError(403, 'Chỉ người nhận việc mới có thể xin gia hạn!');
  }
  const newDeadline = payload?.newDeadline;
  const reason = payload?.reason;
  if (!newDeadline) throw new HttpError(400, 'Vui lòng chọn hạn hoàn thành mới!');
  if (!reason) throw new HttpError(400, 'Vui lòng nhập lý do xin gia hạn!');

  task.pendingExtension = { newDeadline, reason, requestedBy: user.username, requestedByName: user.name, requestedAt: nowVN() };
  task.history = Array.isArray(task.history) ? task.history : [];
  task.history.push({ action: 'EXTENSION_REQUESTED', by: user.username, byName: user.name, time: nowVN(), note: `Xin gia hạn tới ${newDeadline}. Lý do: ${reason}` });
  return task;
}

// Khớp đúng confirmCancelTask() ở client: người giao việc/admin huỷ có hiệu lực NGAY; người nhận việc/
// phối hợp gửi YÊU CẦU chờ duyệt.
function cancelOrRequestCancelTask(payload, user, task) {
  const reason = payload?.reason;
  if (!reason) throw new HttpError(400, 'Vui lòng nhập lý do huỷ!');

  const isAssignerOrAdmin = !!(task.assignedBy === user.username || user.perms?.admin);
  const isRequester = task.assignedTo === user.username || (task.collaborators || []).includes(user.username);
  if (!isAssignerOrAdmin && !isRequester) {
    throw new HttpError(403, 'Bạn không có quyền huỷ công việc này!');
  }

  task.history = Array.isArray(task.history) ? task.history : [];
  if (isAssignerOrAdmin) {
    task.status = 'CANCELLED';
    task.history.push({ action: 'CANCELLED', by: user.username, byName: user.name, time: nowVN(), note: reason });
  } else {
    task.pendingCancellation = { reason, requestedBy: user.username, requestedByName: user.name, requestedAt: nowVN() };
    task.history.push({ action: 'CANCEL_REQUESTED', by: user.username, byName: user.name, time: nowVN(), note: reason });
  }
  return task;
}

// Vòng đời "xin - duyệt/từ chối" của Gia hạn và Huỷ việc giống hệt nhau ở bước DUYỆT/TỪ CHỐI (chỉ
// khác ở bước XIN — xem requestExtension()/cancelOrRequestCancelTask() riêng ở trên) — dùng 1 engine
// chung thay vì lặp lại 4 lần (approveExtension/rejectExtension/approveCancellation/rejectCancellation).
const PENDING_TASK_CONFIGS = {
  extension: {
    field: 'pendingExtension',
    resolveErrorMsg: 'Chỉ người giao việc mới có thể duyệt yêu cầu gia hạn!',
    approvedAction: 'EXTENSION_APPROVED',
    rejectedAction: 'EXTENSION_REJECTED',
    applyApprove: (task, p) => {
      const oldDeadline = task.deadline;
      task.deadline = p.newDeadline;
      task.extensionCount = (task.extensionCount || 0) + 1;
      task.lateCount = (task.lateCount || 0) + 1;
      return `Đồng ý gia hạn từ ${oldDeadline || 'chưa đặt'} sang ${p.newDeadline}. Lý do: ${p.reason}`;
    },
    rejectedNote: (p) => `Từ chối yêu cầu gia hạn tới ${p.newDeadline}`
  },
  cancellation: {
    field: 'pendingCancellation',
    resolveErrorMsg: 'Chỉ người giao việc mới có thể duyệt yêu cầu huỷ!',
    approvedAction: 'CANCELLED', // khớp đúng tên action khi huỷ trực tiếp (cancelOrRequestCancelTask)
    rejectedAction: 'CANCEL_REJECTED',
    applyApprove: (task, p) => {
      task.status = 'CANCELLED';
      return `Đồng ý huỷ theo yêu cầu của ${p.requestedByName}. Lý do: ${p.reason}`;
    },
    rejectedNote: (p) => `Từ chối yêu cầu huỷ. Lý do xin huỷ: ${p.reason}`
  }
};

function resolvePendingTaskAction(kind, verb, user, task) {
  const config = PENDING_TASK_CONFIGS[kind];
  const pending = task[config.field];
  if (!pending) throw new HttpError(404, 'Không tìm thấy yêu cầu đang chờ duyệt');
  if (!(task.assignedBy === user.username || user.perms?.admin)) {
    throw new HttpError(403, config.resolveErrorMsg);
  }

  task.history = Array.isArray(task.history) ? task.history : [];
  if (verb === 'approve') {
    const note = config.applyApprove(task, pending);
    task[config.field] = null;
    task.history.push({ action: config.approvedAction, by: user.username, byName: user.name, time: nowVN(), note });
  } else {
    const note = config.rejectedNote(pending);
    task[config.field] = null;
    task.history.push({ action: config.rejectedAction, by: user.username, byName: user.name, time: nowVN(), note });
  }
  return task;
}

// ===================== VĂN PHÒNG PHẨM (đóng kỳ đăng ký) =====================
// "Kỳ đăng ký" tự coi là đóng khi đã qua endDate (kiểm tra ngay lúc nộp đăng ký, xem
// lib/createValidation.js CREATE_MODULE_CONFIGS.vppRegistrations) — hàm này chỉ xử lý nhánh NGƯỜI
// QUẢN LÝ tự bấm kết thúc kỳ SỚM (trước endDate, hoặc kỳ không đặt endDate).
function closeVppPeriod(user, period) {
  if (!user.perms?.admin && !user.perms?.vppManage) {
    throw new HttpError(403, 'Chỉ người có quyền quản lý Văn phòng phẩm mới được kết thúc kỳ đăng ký');
  }
  if (period.status === 'CLOSED') throw new HttpError(409, 'Kỳ đăng ký này đã kết thúc từ trước');
  period.status = 'CLOSED';
  period.closedAt = nowVN();
  period.closedBy = user.username;
  return period;
}

// ===================== VĂN PHÒNG PHẨM (nộp/sửa đăng ký NHÁP) =====================
// "Kết thúc chọn" ở giao diện tạo hồ sơ NHÁP qua route /api/create/vppRegistrations (xem
// lib/createValidation.js) — 2 hàm dưới xử lý phần còn lại của vòng đời: sửa nội dung khi còn NHÁP,
// và "Gửi" để chính thức vào quy trình duyệt (NHÁP -> CHỜ DUYỆT, bắt đầu từ bước 1).
function submitVppRegistration(user, item) {
  if (item.creator !== user.username) throw new HttpError(403, 'Chỉ người tạo đăng ký mới được gửi hồ sơ này');
  if (item.status !== 'DRAFT') throw new HttpError(409, 'Đăng ký này không còn ở trạng thái nháp (có thể đã gửi hoặc đã bị xử lý)');
  if (!Array.isArray(item.items) || !item.items.length) {
    throw new HttpError(400, 'Chưa chọn mặt hàng nào — vui lòng chọn ít nhất 1 mặt hàng trước khi gửi');
  }
  if (!item.history) item.history = [];
  item.history.push({ step: 0, approver: user.name, username: user.username, action: 'SUBMITTED', comment: '', time: nowVN() });
  item.status = 'PENDING';
  item.currentStep = 1;
  return item;
}

// period: bản ghi kỳ đăng ký tương ứng item.periodId — CALLER (routes/records.js) tự đọc trước rồi
// truyền vào (hàm này không tự đọc DB, giữ đúng nguyên tắc chung — xem đầu file lib/createValidation.js).
function updateVppRegistrationDraft(user, item, payload, period) {
  if (item.creator !== user.username) throw new HttpError(403, 'Chỉ người tạo đăng ký mới được sửa hồ sơ này');
  if (item.status !== 'DRAFT') throw new HttpError(409, 'Đăng ký này không còn ở trạng thái nháp, không thể sửa');
  if (!period) throw new HttpError(404, 'Không tìm thấy kỳ đăng ký');
  const todayStr = new Date().toISOString().slice(0, 10);
  const pastEndDate = !!(period.endDate && todayStr > period.endDate);
  if (period.status !== 'OPEN' || pastEndDate) {
    throw new HttpError(409, 'Kỳ đăng ký này đã kết thúc, không thể sửa đăng ký nữa');
  }
  item.items = validateVppRegItems(payload.items, period.catalogItems);
  return item;
}

// ===================== BÁO CÁO ĐỊNH KỲ (kỳ báo cáo: đóng sớm/tổng hợp/phát hành) =====================
// Vòng đời: OPEN (nhận nhập liệu, tới khi qua endTime HOẶC admin/reportAggregate đóng sớm) -> CLOSED
// -> Tổng hợp (Merge, dựng compilation.slides từ các reportEntries SUBMITTED đã chọn+sắp thứ tự) ->
// Chỉnh sửa (compilation.status='MERGED', sửa tự do từng slide) -> Phát hành (compilation.status=
// 'PUBLISHED', khoá sửa — có thể "Hủy phát hành" quay lại 'MERGED' để sửa tiếp). Quyền tổng hợp
// (`reportAggregate`) là quyền CHUNG — bất kỳ ai có quyền này đều tổng hợp được MỌI kỳ, không phân
// biệt ai tạo kỳ đó (đã chốt với người yêu cầu, khác mô hình "người duyệt được chỉ định theo từng
// bước" ở nơi khác trong hệ thống).
function isReportPeriodClosed(period) {
  if (period.status === 'CLOSED') return true;
  return !!(period.endTime && Date.now() > new Date(period.endTime).getTime());
}

function canManageReportPeriods(user) {
  return !!(user.perms?.admin || user.perms?.reportManage);
}

function canAggregateReports(user) {
  return !!(user.perms?.admin || user.perms?.reportAggregate);
}

// Người quản lý kỳ tự đóng SỚM (trước endTime) — giống closeVppPeriod(). Đóng rồi thì reportEntries
// không tạo/sửa được nữa (xem CREATE_MODULE_CONFIGS.reportEntries + updateReportEntryDraft dưới đây),
// dù endTime chưa tới.
function closeReportPeriod(user, period) {
  if (!canManageReportPeriods(user)) {
    throw new HttpError(403, 'Chỉ người có quyền quản lý Báo Cáo Định Kỳ mới được đóng kỳ báo cáo');
  }
  if (period.status === 'CLOSED') throw new HttpError(409, 'Kỳ báo cáo này đã đóng từ trước');
  period.status = 'CLOSED';
  period.closedAt = nowVN();
  period.closedBy = user.username;
  return period;
}

// "Gửi": NHÁP -> SUBMITTED (chốt hẳn — đã bỏ luồng "yêu cầu bổ sung", nhân viên không sửa lại được
// nữa sau khi gửi). period: bản ghi kỳ tương ứng item.periodId — CALLER (routes/records.js) đọc trước
// rồi truyền vào, cùng nguyên tắc với updateVppRegistrationDraft().
function submitReportEntry(user, item, period) {
  if (item.creator !== user.username) throw new HttpError(403, 'Chỉ người tạo báo cáo mới được gửi báo cáo này');
  if (item.status !== 'DRAFT') throw new HttpError(409, 'Báo cáo này không còn ở trạng thái nháp (có thể đã gửi rồi)');
  if (!period) throw new HttpError(404, 'Không tìm thấy kỳ báo cáo');
  if (isReportPeriodClosed(period)) {
    throw new HttpError(409, 'Kỳ báo cáo này đã kết thúc, không thể gửi báo cáo nữa');
  }
  if (!item.title || !String(item.title).trim()) {
    throw new HttpError(400, 'Báo cáo còn thiếu tiêu đề — vui lòng bổ sung trước khi gửi');
  }
  item.status = 'SUBMITTED';
  item.submittedAt = nowVN();
  return item;
}

// Sửa nội dung khi báo cáo còn NHÁP — period truyền vào giống submitReportEntry(). Dùng chung
// normalizeReportEntryPayload() với lúc tạo mới (xem lib/createValidation.js CREATE_MODULE_CONFIGS.
// reportEntries) để 2 luồng tạo/sửa luôn validate/chuẩn hoá dữ liệu giống hệt nhau — CreateError ném ra
// từ đó chính là HttpError đổi tên (xem lib/httpErrors.js), nên bắt lỗi phía route vẫn hoạt động đúng.
function updateReportEntryDraft(user, item, payload, period) {
  if (item.creator !== user.username) throw new HttpError(403, 'Chỉ người tạo báo cáo mới được sửa báo cáo này');
  if (item.status !== 'DRAFT') throw new HttpError(409, 'Báo cáo này không còn ở trạng thái nháp, không thể sửa');
  if (!period) throw new HttpError(404, 'Không tìm thấy kỳ báo cáo');
  if (isReportPeriodClosed(period)) {
    throw new HttpError(409, 'Kỳ báo cáo này đã kết thúc, không thể sửa báo cáo nữa');
  }
  const title = String(payload?.title || '').trim();
  if (!title) throw new HttpError(400, 'Thiếu tiêu đề báo cáo');
  const draft = { ...payload, title };
  normalizeReportEntryPayload(draft);
  item.title = draft.title;
  item.fileUrl = draft.fileUrl;
  item.fileName = draft.fileName;
  item.fileType = draft.fileType;
  item.parsedSlides = draft.parsedSlides;
  return item;
}

// Tổng hợp (Merge): dựng compilation.slides từ các reportEntries SUBMITTED thuộc ĐÚNG kỳ này mà người
// tổng hợp đã chọn + sắp thứ tự (orderedEntryIds) — snapshot nội dung NGAY LÚC merge (đổi báo cáo gốc
// sau đó, nếu có, không ảnh hưởng slide đã snapshot — nhưng thực tế báo cáo gốc cũng không sửa được
// nữa vì đã SUBMITTED). Cho phép merge lại nhiều lần (chọn lại danh sách/thứ tự khác) khi
// compilation chưa PUBLISHED — muốn sửa sau khi đã phát hành phải "Hủy phát hành" trước.
// entries: TOÀN BỘ reportEntries hiện có — CALLER tự đọc rồi truyền vào (không tự đọc DB, giữ đúng
// nguyên tắc chung của file này).
function mergeReportPeriod(user, period, orderedEntryIds, entries) {
  if (!canAggregateReports(user)) {
    throw new HttpError(403, 'Bạn không có quyền tổng hợp Báo Cáo Định Kỳ');
  }
  if (!isReportPeriodClosed(period)) {
    throw new HttpError(409, 'Kỳ báo cáo chưa kết thúc — chưa thể tổng hợp');
  }
  if (period.compilation?.status === 'PUBLISHED') {
    throw new HttpError(409, 'Bản tổng hợp đã phát hành — vui lòng "Hủy phát hành" trước khi tổng hợp lại');
  }
  const ids = Array.isArray(orderedEntryIds) ? [...new Set(orderedEntryIds)] : [];
  if (!ids.length) throw new HttpError(400, 'Vui lòng chọn ít nhất 1 báo cáo để tổng hợp');
  const periodEntries = (entries || []).filter(e => e.periodId === period.id && e.status === 'SUBMITTED');
  // Mỗi báo cáo (1 người/1 kỳ) giờ dựng ra NHIỀU slide theo đúng khuôn mẫu PowerPoint công ty cung cấp
  // (Phòng ban -> Bảng Công Việc Tuần Này -> Bảng Kế Hoạch Tiếp Theo -> Số Liệu -> tối đa 2 slide Khác)
  // thay vì 1 người = 1 slide như trước — slide nào không có nội dung thì bỏ qua, không sinh trang trống.
  // Báo cáo mode FILE_UPLOAD (đính nguyên 1 tệp đã làm sẵn, không gõ lại) chỉ sinh đúng 1 slide tham
  // chiếu tới tệp đó. Trang bìa "BÁO CÁO TUẦN" chỉ sinh 1 lần duy nhất cho cả bản tổng hợp.
  //
  // Gom TRƯỚC theo phòng ban (không sinh slide xen kẽ theo đúng thứ tự orderedEntryIds như trước) — mỗi
  // phòng chỉ ra ĐÚNG 1 slide chia (kind DEPT, tên phòng thuần, không kèm tên người) đứng trước TOÀN BỘ
  // nội dung của mọi báo cáo thuộc phòng đó, kể cả khi người tổng hợp chọn/sắp các báo cáo cùng phòng ở
  // các vị trí không liền nhau — để khi họp nhiều phòng, người điều hành chuyển sang phòng nào là gặp
  // đúng 1 slide chia rồi tới hết nội dung phòng đó, không bị lặp lại slide chia giữa chừng. Thứ tự các
  // phòng = thứ tự phòng xuất hiện LẦN ĐẦU trong danh sách đã chọn (người tổng hợp vẫn kiểm soát được
  // phòng nào lên trước qua cách sắp thứ tự); thứ tự người trong cùng 1 phòng giữ nguyên như đã chọn.
  const deptOrder = [];
  const entriesByDept = new Map();
  ids.forEach((id) => {
    const entry = periodEntries.find(e => e.id === id);
    if (!entry) throw new HttpError(400, `Báo cáo #${id} không hợp lệ (không thuộc kỳ này hoặc chưa được gửi)`);
    if (!entriesByDept.has(entry.dept)) { entriesByDept.set(entry.dept, []); deptOrder.push(entry.dept); }
    entriesByDept.get(entry.dept).push(entry);
  });

  const slides = [{ kind: 'COVER', title: `BÁO CÁO TUẦN — ${period.name}` }];
  deptOrder.forEach((dept) => {
    slides.push({ kind: 'DEPT', title: dept });
    entriesByDept.get(dept).forEach((entry) => {
      const common = { sourceEntryId: entry.id, sourceCreatorName: entry.creatorName, sourceDept: entry.dept };
      // Mỗi báo cáo (.pptx đã được TRÌNH DUYỆT người nộp tự đọc thành parsedSlides lúc nộp — xem
      // normalizeReportEntryPayload() ở lib/createValidation.js) sinh ra ĐÚNG 1 slide kind PPTX_SLIDE
      // cho MỖI slide gốc trong file .pptx đó, giữ nguyên thứ tự — không còn gộp theo Công Việc/Kế
      // Hoạch/Số Liệu/Khác như trước (mô hình nhập tay đã bỏ).
      (entry.parsedSlides || []).forEach((ps) => {
        slides.push({
          kind: 'PPTX_SLIDE',
          title: ps.title || '',
          bodyLines: Array.isArray(ps.bodyLines) ? ps.bodyLines : [],
          images: Array.isArray(ps.images) ? ps.images : [],
          ...common
        });
      });
    });
  });
  slides.forEach((s, idx) => { s.order = idx + 1; });
  period.compilation = {
    slides,
    status: 'MERGED',
    compiledBy: user.username, compiledByName: user.name, compiledAt: nowVN(),
    updatedBy: null, updatedByName: null, updatedAt: null,
    publishedBy: null, publishedByName: null, publishedAt: null
  };
  return period;
}

// Parse ngược chuỗi "HH:MM:SS D/M/YYYY" do new Date().toLocaleString('vi-VN') sinh ra (nowVN(), dùng
// cho mọi task.history[].time) — bản sao server-side của parseVNDateTime() ở public/index.html (LƯU Ý
// BẢO TRÌ, 2 bản độc lập, phải sửa đồng thời) vì lib/ không dùng chung code với client.
function parseVNDateTime(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.trim().split(' ');
  if (parts.length !== 2) return null;
  const [timePart, datePart] = parts;
  const timeBits = timePart.split(':').map(Number);
  const dateBits = datePart.split('/').map(Number);
  if (dateBits.length !== 3 || dateBits.some(isNaN)) return null;
  const [h, mi, s] = timeBits;
  const [d, mo, y] = dateBits;
  const dt = new Date(y, mo - 1, d, h || 0, mi || 0, s || 0);
  return isNaN(dt.getTime()) ? null : dt;
}

const TASK_STATUS_LABELS = { TODO: 'Chưa bắt đầu', DOING: 'Đang thực hiện', DONE: 'Đã hoàn thành', CANCELLED: 'Đã hủy' };

// Tổng Hợp Theo Công Việc — CÁCH THỨ 2 để dựng compilation.slides của 1 kỳ (cùng khuôn dữ liệu, cùng
// dùng chung updateReportCompilation()/publishReportPeriod()/unpublishReportPeriod() phía sau với
// mergeReportPeriod() ở trên), nhưng nguồn là DB.tasks — TỰ ĐỘNG lấy công việc thật của từng người,
// không cần ai gõ tay báo cáo. Hai nút "Tổng Hợp Theo Báo Cáo"/"Tổng Hợp Theo Công Việc" ở client là 2
// LỰA CHỌN NGUỒN khác nhau cho CÙNG 1 compilation — bấm cái nào sau cùng thì compilation theo cách đó
// (y hệt hành vi "tổng hợp lại" đã có của mergeReportPeriod(), không cộng dồn 2 nguồn).
//
// Phạm vi thời gian tính vào kỳ = (mốc hạn chót của kỳ ĐÃ ĐÓNG gần nhất kết thúc TRƯỚC kỳ này, nếu có]
// -> hạn chót kỳ này; kỳ đầu tiên (không có kỳ nào đóng trước đó) thì không giới hạn mốc bắt đầu. Việc
// ĐÃ XONG chỉ tính nếu hoàn thành (history STATUS_DONE gần nhất) rơi vào khoảng này; việc CÒN MỞ
// (TODO/DOING) chỉ tính nếu hạn chót không vượt quá hạn chót kỳ này (việc hạn xa hơn thuộc kỳ sau).
// tasks/users/allPeriods: CALLER tự đọc rồi truyền vào (không tự đọc DB), giữ đúng nguyên tắc chung.
function mergeReportPeriodByTasks(user, period, tasks, users, allPeriods) {
  if (!canAggregateReports(user)) {
    throw new HttpError(403, 'Bạn không có quyền tổng hợp Báo Cáo Định Kỳ');
  }
  if (!isReportPeriodClosed(period)) {
    throw new HttpError(409, 'Kỳ báo cáo chưa kết thúc — chưa thể tổng hợp');
  }
  if (period.compilation?.status === 'PUBLISHED') {
    throw new HttpError(409, 'Bản tổng hợp đã phát hành — vui lòng "Hủy phát hành" trước khi tổng hợp lại');
  }
  const endBoundary = new Date(period.endTime);
  if (isNaN(endBoundary.getTime())) throw new HttpError(400, 'Kỳ báo cáo thiếu hạn chót hợp lệ');

  let startBoundary = null;
  (allPeriods || []).forEach((p) => {
    if (p.id === period.id || p.status !== 'CLOSED' || !p.endTime) return;
    const t = new Date(p.endTime);
    if (isNaN(t.getTime()) || t >= endBoundary) return;
    if (!startBoundary || t > startBoundary) startBoundary = t;
  });

  const usersByUsername = new Map((users || []).map(u => [u.username, u]));
  const inScope = (dept) => !!(period.deptScope?.all || (period.deptScope?.depts || []).includes(dept));
  const isOverdue = (t) => t.status !== 'DONE' && t._deadlineDate && !isNaN(t._deadlineDate.getTime()) && t._deadlineDate < endBoundary;
  const GROUP_ORDER = { 'Quá hạn': 0, 'Đang thực hiện': 1, 'Đã hoàn thành': 2 };

  // Gom công việc theo phòng ban của NGƯỜI ĐƯỢC GIAO (assignedTo) — không xác định được phòng ban
  // (tài khoản assignedTo không còn tồn tại) thì bỏ qua, không tính vào tổng hợp.
  const deptOrder = [];
  const byDept = new Map(); // dept -> Map(username -> { name, tasks: [] })
  (tasks || []).forEach((raw) => {
    if (raw.status === 'CANCELLED') return;
    const assignee = usersByUsername.get(raw.assignedTo);
    const dept = assignee?.dept;
    if (!dept || !inScope(dept)) return;

    const t = { ...raw };
    t._deadlineDate = t.deadline ? new Date(t.deadline) : null;
    if (t.status === 'DONE') {
      const doneEntry = [...(t.history || [])].reverse().find(h => h.action === 'STATUS_DONE');
      const doneAt = doneEntry ? parseVNDateTime(doneEntry.time) : null;
      if (!doneAt || doneAt > endBoundary || (startBoundary && doneAt < startBoundary)) return;
    } else if (t._deadlineDate && !isNaN(t._deadlineDate.getTime()) && t._deadlineDate > endBoundary) {
      return; // hạn chót thuộc kỳ sau, chưa cần báo cáo ở kỳ này
    }

    if (!byDept.has(dept)) { byDept.set(dept, new Map()); deptOrder.push(dept); }
    const deptMap = byDept.get(dept);
    if (!deptMap.has(t.assignedTo)) deptMap.set(t.assignedTo, { name: assignee.name || t.assignedToName || t.assignedTo, tasks: [] });
    deptMap.get(t.assignedTo).tasks.push(t);
  });

  if (!deptOrder.length) {
    throw new HttpError(400, 'Không có công việc nào phù hợp phạm vi/khoảng thời gian của kỳ này để tổng hợp');
  }

  const slides = [{ kind: 'COVER', title: `TỔNG HỢP CÔNG VIỆC — ${period.name}` }];
  deptOrder.forEach((dept) => {
    slides.push({ kind: 'DEPT', title: dept });
    const deptMap = byDept.get(dept);
    const allDeptTasks = [...deptMap.values()].flatMap(v => v.tasks);
    const counts = { DONE: 0, DOING: 0, TODO: 0 };
    let overdueCount = 0;
    allDeptTasks.forEach((t) => {
      counts[t.status] = (counts[t.status] || 0) + 1;
      if (isOverdue(t)) overdueCount++;
    });
    const statsText = [
      `Tổng số công việc: ${allDeptTasks.length}`,
      `— Đã hoàn thành: ${counts.DONE}`,
      `— Đang thực hiện: ${counts.DOING}`,
      `— Chưa bắt đầu: ${counts.TODO}`,
      `— Quá hạn: ${overdueCount}`
    ].join('\n');
    slides.push({ kind: 'TASK_STATS', title: 'THỐNG KÊ CÔNG VIỆC', text: statsText, sourceDept: dept });

    [...deptMap.entries()].forEach(([, info]) => {
      const items = info.tasks
        .map(t => ({
          _group: isOverdue(t) ? 'Quá hạn' : (t.status === 'DONE' ? 'Đã hoàn thành' : 'Đang thực hiện'),
          group: isOverdue(t) ? 'Quá hạn' : (t.status === 'DONE' ? 'Đã hoàn thành' : 'Đang thực hiện'),
          content: t.title || '',
          progress: TASK_STATUS_LABELS[t.status] || t.status,
          deadline: t.deadline || '',
          support: (t.collaborators || []).length ? `Phối hợp: ${t.collaborators.length} người` : ''
        }))
        .sort((a, b) => (GROUP_ORDER[a._group] ?? 9) - (GROUP_ORDER[b._group] ?? 9))
        .map(({ _group, ...rest }) => rest);
      slides.push({ kind: 'TASKS', title: 'DANH SÁCH CÔNG VIỆC', items, sourceCreatorName: info.name, sourceDept: dept });
    });
  });
  slides.forEach((s, idx) => { s.order = idx + 1; });

  period.compilation = {
    slides,
    status: 'MERGED',
    compiledBy: user.username, compiledByName: user.name, compiledAt: nowVN(),
    updatedBy: null, updatedByName: null, updatedAt: null,
    publishedBy: null, publishedByName: null, publishedAt: null
  };
  return period;
}

// Gom + dọn danh sách dòng bảng Công Việc/Kế Hoạch — dùng chung cho cả TASKS (progressField='progress')
// và PLAN (progressField='plan'), khớp normalizeReportEntryPayload() ở lib/createValidation.js.
function cleanReportTableItems(arr, progressField) {
  return (Array.isArray(arr) ? arr : [])
    .map(it => ({
      group: String(it?.group || '').trim(),
      content: String(it?.content || '').trim(),
      [progressField]: String(it?.[progressField] || '').trim(),
      deadline: String(it?.deadline || '').trim(),
      support: String(it?.support || '').trim()
    }))
    .filter(it => it.content || it[progressField] || it.deadline || it.support);
}

// Chỉnh sửa slide sau khi đã tổng hợp (thêm/xoá dòng bảng, sửa nội dung/sắp lại thứ tự) — chỉ khi
// compilation.status = 'MERGED' (chưa phát hành). Mỗi loại slide (kind) có bộ field riêng khớp đúng
// mergeReportPeriod() ở trên — không cho đổi kind của 1 slide đã có (chỉ sửa nội dung/xoá/sắp thứ tự).
function updateReportCompilation(user, period, slides) {
  if (!canAggregateReports(user)) {
    throw new HttpError(403, 'Bạn không có quyền tổng hợp Báo Cáo Định Kỳ');
  }
  if (!period.compilation || period.compilation.status !== 'MERGED') {
    throw new HttpError(409, 'Kỳ báo cáo chưa có bản tổng hợp ở trạng thái đang sửa');
  }
  const list = Array.isArray(slides) ? slides : [];
  if (!list.length) throw new HttpError(400, 'Bản tổng hợp cần có ít nhất 1 slide');
  const validKinds = ['COVER', 'DEPT', 'TASKS', 'PLAN', 'NUMBERS', 'OTHER', 'FILE', 'TASK_STATS', 'PPTX_SLIDE'];
  const IMAGE_KINDS = ['embedded', 'table', 'chart'];
  const cleaned = list.map((s, idx) => {
    const kind = validKinds.includes(s?.kind) ? s.kind : 'OTHER';
    const title = String(s?.title || '').trim();
    // PPTX_SLIDE: slide gốc trong .pptx có thể KHÔNG có tiêu đề (không phải mọi slide PowerPoint đều có
    // khung tiêu đề) — chỉ các kind khác mới bắt buộc phải có tiêu đề.
    if (!title && kind !== 'PPTX_SLIDE') throw new HttpError(400, `Slide thứ ${idx + 1} thiếu tiêu đề`);
    const base = {
      order: idx + 1, kind, title,
      sourceEntryId: s?.sourceEntryId ?? null, sourceCreatorName: s?.sourceCreatorName || '', sourceDept: s?.sourceDept || ''
    };
    if (kind === 'TASKS') return { ...base, items: cleanReportTableItems(s.items, 'progress') };
    if (kind === 'PLAN') return { ...base, items: cleanReportTableItems(s.items, 'plan') };
    if (kind === 'TASK_STATS') return { ...base, text: String(s?.text || '').trim() };
    if (kind === 'NUMBERS' || kind === 'OTHER') {
      return {
        ...base, text: String(s?.text || '').trim(),
        fileUrl: s?.fileUrl || null,
        fileName: s?.fileUrl ? String(s?.fileName || '') : null,
        fileType: s?.fileUrl ? String(s?.fileType || '') : null
      };
    }
    if (kind === 'FILE') {
      return {
        ...base,
        fileUrl: s?.fileUrl || null,
        fileName: s?.fileUrl ? String(s?.fileName || '') : null,
        fileType: s?.fileUrl ? String(s?.fileType || '') : null
      };
    }
    if (kind === 'PPTX_SLIDE') {
      const bodyLines = (Array.isArray(s?.bodyLines) ? s.bodyLines : []).map(l => String(l || '').trim()).filter(Boolean);
      const images = (Array.isArray(s?.images) ? s.images : [])
        .filter(im => im && typeof im.dataUrl === 'string' && im.dataUrl.startsWith('data:image/'))
        .map(im => ({ dataUrl: im.dataUrl, kind: IMAGE_KINDS.includes(im.kind) ? im.kind : 'embedded' }));
      return { ...base, bodyLines, images };
    }
    return base; // COVER / DEPT — chỉ có title
  });
  period.compilation.slides = cleaned;
  period.compilation.updatedBy = user.username;
  period.compilation.updatedByName = user.name;
  period.compilation.updatedAt = nowVN();
  return period;
}

// Sửa mẫu trình chiếu đã tạo (tên/màu sắc) — cùng quyền reportManage với tạo/đóng kỳ báo cáo, vì mẫu
// chỉ dùng lúc TẠO KỲ (xem CREATE_MODULE_CONFIGS.reportPeriods ở lib/createValidation.js), không ảnh
// hưởng tới kỳ đã tạo trước đó (mỗi kỳ đã "chốt cứng" slideTemplateId của mình lúc tạo).
function updateReportSlideTemplate(user, item, payload) {
  if (!canManageReportPeriods(user)) {
    throw new HttpError(403, 'Chỉ người có quyền quản lý Báo Cáo Định Kỳ mới được sửa mẫu trình chiếu');
  }
  const name = String(payload?.name || '').trim();
  if (!name) throw new HttpError(400, 'Thiếu tên mẫu trình chiếu');
  item.name = name;
  // Có chọn tệp mới (bgImageUrl) → chuyển hẳn sang dạng ảnh nền mới, xoá bộ 12 màu cũ nếu có (kể cả khi
  // sửa 1 mẫu 12-màu đời cũ — chuyển thẳng sang dạng mới, không giữ cả 2 dữ liệu song song). Không chọn
  // tệp mới → chỉ đổi tên, giữ NGUYÊN dữ liệu nền hiện có (dù {colors} cũ hay {bgImageUrl,isDark} mới) —
  // không ép migrate mẫu cũ khi admin chỉ muốn đổi tên.
  if (payload && typeof payload.bgImageUrl === 'string' && payload.bgImageUrl.trim()) {
    item.bgImageUrl = payload.bgImageUrl.trim();
    item.isDark = !!payload.isDark;
    delete item.colors;
  }
  return item;
}

function publishReportPeriod(user, period) {
  if (!canAggregateReports(user)) {
    throw new HttpError(403, 'Bạn không có quyền tổng hợp Báo Cáo Định Kỳ');
  }
  if (!period.compilation || period.compilation.status !== 'MERGED') {
    throw new HttpError(409, 'Chưa có bản tổng hợp ở trạng thái sẵn sàng phát hành');
  }
  period.compilation.status = 'PUBLISHED';
  period.compilation.publishedBy = user.username;
  period.compilation.publishedByName = user.name;
  period.compilation.publishedAt = nowVN();
  return period;
}

// Hủy phát hành — quay lại 'MERGED' để sửa tiếp, không xoá slide đã có.
function unpublishReportPeriod(user, period) {
  if (!canAggregateReports(user)) {
    throw new HttpError(403, 'Bạn không có quyền tổng hợp Báo Cáo Định Kỳ');
  }
  if (!period.compilation || period.compilation.status !== 'PUBLISHED') {
    throw new HttpError(409, 'Bản tổng hợp này chưa phát hành');
  }
  period.compilation.status = 'MERGED';
  period.compilation.publishedBy = null;
  period.compilation.publishedByName = null;
  period.compilation.publishedAt = null;
  return period;
}

module.exports = {
  editContract,
  canManageContractPayment, uploadContractSignedFile, startContractPayment,
  canManageOfficePayment, uploadOfficeSignedFile, startOfficePayment,
  canManagePaymentRequests, editPaymentRequest, requestPaymentInfo, approvePaymentRequest,
  confirmPaymentInstallment, assertCanDeletePaymentRequest,
  canEditMinutes, canDeleteMinutes, editMinutes, assertCanDeleteMinutes,
  canCreateMinutes, createMinutes, buildTasksFromDirectives, assignMinutesTasks, buildTaskFromSubmissionComment,
  markInternalPostRead, toggleInternalPostLike, addInternalPostComment,
  registerInternalPostTraining, unregisterInternalPostTraining,
  canApproveInternalPost, approveInternalPost, rejectInternalPost,
  canManageTasks, canDeleteTaskPerm, canAssignSpecificTask, assignTask, editTask, assertCanDeleteTask,
  createTask,
  acceptTask, confirmCollaboratorParticipation, updateTaskStatusAction, requestExtension,
  cancelOrRequestCancelTask, resolvePendingTaskAction,
  addSubtask, toggleSubtask, deleteSubtask,
  closeVppPeriod, submitVppRegistration, updateVppRegistrationDraft,
  closeReportPeriod, submitReportEntry, updateReportEntryDraft,
  mergeReportPeriod, mergeReportPeriodByTasks, updateReportCompilation, publishReportPeriod, unpublishReportPeriod,
  updateReportSlideTemplate
};
