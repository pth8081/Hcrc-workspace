// lib/recordActions.js — Bước 2b (phương án C bảo mật): server tự xác minh quyền SỬA/XÓA/GIAO hồ sơ
// đã tồn tại (Hợp đồng, Biên bản họp, Công việc) — trước đây các thao tác này chỉ được chặn bằng hàm
// JS thuần ở client (canEditMeetingMinutesRecord()/canDeleteTaskRecord()/so sánh c.creator...), sau đó
// ghi thẳng TOÀN BỘ mảng dữ liệu lên qua POST /api/data/:key — 1 request tự soạn bỏ qua UI vẫn sửa/xóa
// được hồ sơ của người khác vì server chưa từng xác minh lại gì ở mức từng bản ghi.
//
// Khác lib/createValidation.js (đều là {all,depts} cho 6 module), 3 module ở đây có hình dạng quyền
// khác nhau nên không gộp vào 1 engine chung được: Hợp đồng chỉ theo "người tạo hoặc admin"; Biên bản
// họp thêm cờ minutesEdit/minutesDelete (toàn công ty, không theo phòng ban); Công việc theo NGƯỜI
// (assignedBy/assignee), hoàn toàn không có khái niệm phòng ban.
const { HttpError } = require('./httpErrors');
const { scopeAllows, OFFICE_SUBTYPE_TO_PERM_FLAG } = require('./createValidation');

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

// Duyệt/từ chối hợp đồng GỐC (approvalStatus PENDING gán sẵn khi tạo — xem lib/createValidation.js) —
// cờ toàn công ty contractApprove, khớp đúng hình dạng meetingApprove/internalPostApprove, không theo
// phòng ban. Từ chối bắt buộc nhập lý do. Phụ lục không qua đây (luôn APPROVED ngay khi tạo).
function canApproveContract(user) {
  return !!(user.perms?.admin || user.perms?.contractApprove);
}

function approveContract(user, contract) {
  if (contract.isAddendum) throw new HttpError(400, 'Phụ lục hợp đồng không qua bước duyệt riêng');
  if (!canApproveContract(user)) throw new HttpError(403, 'Bạn không có quyền phê duyệt hợp đồng này');
  if (contract.approvalStatus !== 'PENDING') throw new HttpError(409, 'Hợp đồng không ở trạng thái chờ duyệt');
  contract.approvalStatus = 'APPROVED';
  contract.approvedBy = user.username;
  contract.approvedByName = user.name;
  contract.approvedAt = nowVN();
  return contract;
}

function rejectContract(payload, user, contract) {
  if (contract.isAddendum) throw new HttpError(400, 'Phụ lục hợp đồng không qua bước duyệt riêng');
  if (!canApproveContract(user)) throw new HttpError(403, 'Bạn không có quyền từ chối hợp đồng này');
  if (contract.approvalStatus !== 'PENDING') throw new HttpError(409, 'Hợp đồng không ở trạng thái chờ duyệt');
  const reason = (payload?.reason || '').trim();
  if (!reason) throw new HttpError(400, 'Vui lòng nhập lý do từ chối');
  contract.approvalStatus = 'REJECTED';
  contract.rejectedBy = user.username;
  contract.rejectedByName = user.name;
  contract.rejectedAt = nowVN();
  contract.rejectReason = reason;
  return contract;
}

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
  const { fileName, fileType, fileUrl } = payload || {};
  if (!fileName || !fileUrl) throw new HttpError(400, 'Thiếu tệp tài liệu ký');
  contract.signedFileName = fileName;
  contract.signedFileType = fileType;
  contract.signedFileUrl = fileUrl;
  contract.signedUploadedBy = user.username;
  contract.signedUploadedAt = nowVN();
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

function assertCanDeletePaymentRequest(user, pr) {
  if (!canManagePaymentRequests(user)) throw new HttpError(403, 'Bạn không có quyền xoá đề nghị thanh toán');
  if (pr.status === 'PAID') throw new HttpError(409, 'Đề nghị thanh toán đã hoàn tất — không thể xoá');
}

// ===================== BIÊN BẢN HỌP (sửa/xóa) =====================
// minutesEdit/minutesDelete là cờ toàn công ty (không phải {all,depts}) — khớp đúng
// canEditMeetingMinutesRecord()/canDeleteMeetingMinutesRecord() ở index.html.
function canEditMinutes(user, minutes) {
  return !!(user.perms?.admin || user.perms?.minutesEdit || minutes.creator === user.username);
}
function canDeleteMinutes(user, minutes) {
  return !!(user.perms?.admin || user.perms?.minutesDelete || minutes.creator === user.username);
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
      status: 'TODO',
      extensionCount: 0, lateCount: 0, pendingExtension: null, pendingCancellation: null,
      createdAt: nowVN(),
      history: [{ action: 'CREATED', by: user.username, byName: user.name, time: nowVN() }]
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

function assignTask(payload, user, task, usersList) {
  if (!canAssignSpecificTask(user, task)) {
    throw new HttpError(403, 'Bạn không có quyền gán người nhận cho công việc này');
  }
  if (!payload || typeof payload !== 'object' || !payload.assignedTo) {
    throw new HttpError(400, 'Thiếu người nhận việc');
  }
  task.assignedTo = payload.assignedTo;
  task.assignedToName = resolveAssigneeName(usersList, payload.assignedTo);
  task.deadline = payload.deadline || '';
  task.collaborators = Array.isArray(payload.collaborators) ? payload.collaborators : [];
  task.history = Array.isArray(task.history) ? task.history : [];
  task.history.push({ action: 'ASSIGNED', by: user.username, byName: user.name, time: nowVN() });
  return task;
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

module.exports = {
  editContract,
  canApproveContract, approveContract, rejectContract,
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
  cancelOrRequestCancelTask, resolvePendingTaskAction
};
