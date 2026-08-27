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
const { scopeAllows, OFFICE_SUBTYPE_TO_PERM_FLAG, normalizeReportEntryPayload, buildEffectiveContractApprovalWorkflowServer, sanitizeUniformItems, sanitizeBudgetLines, getBudgetTemplateCustomFields, sanitizeBudgetCustomFields, resolveTrainingInstructorUsername, normalizeInviteList, normalizeTrainingPlanFields, normalizeOnboardingPathFields, SUBMISSION_APPROVAL_LEVELS, buildEffectiveSubmissionWorkflowServer } = require('./createValidation');
const { validateRegistrationItems: validateVppRegItems, calcItemsTotal: calcVppItemsTotal } = require('./vppCatalog');
const { sanitizePriceFileItems } = require('./priceFileParser');

function nowVN() {
  return new Date().toLocaleString('vi-VN');
}

// ===================== HỢP ĐỒNG (sửa) =====================
// Khớp đúng danh sách field mà updateContractReq() ở index.html cho sửa — KHÔNG gồm code/creator/id
// (không đổi được), KHÔNG gồm customData (form sửa hợp đồng không thu thập lại).
const CONTRACT_EDITABLE_FIELDS = ['dept', 'custodianDept', 'type', 'title', 'partner', 'amount', 'startDate', 'endDate', 'content'];

// hasAddenda: caller (routes/records.js) tự tra collection để biết hợp đồng gốc này đã có phụ lục
// nào kế thừa dept của nó hay chưa — file này không tự đọc DB (giữ đúng nguyên tắc cũ, xem đầu file).
// appData: caller tự đọc sẵn (workflows/contractApprovalDeptWorkflows/contractApprovalGroups) để dựng
// lại effectiveSteps/effectiveApprovers khi đổi dept — xem giải thích ở khối kiểm tra deptChanged bên dưới.
function editContract(payload, user, contract, hasAddenda, rootDept, appData, rootCustodianDept) {
  // Khớp đúng luật cũ ở client (openEditContract/updateContractReq): CHỈ người tạo mới sửa được, kể
  // cả admin cũng không có ngoại lệ — không mở rộng quyền so với hành vi trước Bước 2b.
  if (contract.creator !== user.username) {
    throw new HttpError(403, 'Bạn chỉ có thể sửa hồ sơ hợp đồng do chính mình tạo!');
  }
  // Trước đây editContract() chỉ xét người tạo, không xét approvalStatus — hợp đồng đã qua đủ các
  // bước duyệt (thậm chí đã bắt đầu thanh toán) vẫn sửa được amount/dept/ngày hiệu lực tự do, khiến
  // giá trị/điều khoản thực tế lệch khỏi những gì đã được duyệt mà không ai hay.
  if (contract.approvalStatus === 'APPROVED') {
    throw new HttpError(409, 'Hợp đồng đã được phê duyệt xong, không thể sửa nữa');
  }
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Thiếu dữ liệu cập nhật');

  // Phụ lục kế thừa dept của hợp đồng gốc lúc tạo (xem createValidation.js contracts.extraValidate) —
  // đổi dept của hợp đồng gốc sau khi đã có phụ lục sẽ phá vỡ ràng buộc "phụ lục cùng phòng ban với
  // gốc", ảnh hưởng tới mọi chỗ lọc quyền theo phòng ban của phụ lục đó.
  // Lưu ý: về mặt runtime, nhánh này hiện luôn KHÔNG bao giờ tới lượt chạy — phụ lục chỉ được tạo khi
  // root.approvalStatus === 'APPROVED' (createValidation.js), và contracts không có đường quay lại
  // DRAFT/REJECTED sau khi đã APPROVED (không có REQUEST_CHANGES) — nên hasAddenda === true kéo theo
  // contract.approvalStatus luôn là 'APPROVED', bị chặn sớm hơn bởi khối kiểm tra APPROVED ở trên. Giữ
  // lại như lớp phòng vệ dự phòng (không phải lỗi) — nếu sau này contracts có thêm đường đưa hợp đồng
  // APPROVED quay lại sửa được (VD REQUEST_CHANGES), nhánh này mới thực sự phát huy tác dụng.
  if (!contract.isAddendum && hasAddenda && payload.dept !== undefined && payload.dept !== contract.dept) {
    throw new HttpError(409, 'Hợp đồng gốc đã có phụ lục — không thể đổi phòng ban');
  }
  // Ngược lại, SỬA ngay chính phụ lục (không phải hợp đồng gốc) mà đổi dept lệch khỏi gốc cũng phá vỡ
  // đúng ràng buộc đó — trước đây chỉ chặn chiều sửa hợp đồng gốc, còn sửa thẳng phụ lục thì không ai
  // kiểm tra lại gì cả (createValidation.js chỉ áp dụng lúc TẠO, không áp dụng lúc SỬA phụ lục).
  if (contract.isAddendum && rootDept !== undefined && payload.dept !== undefined && payload.dept !== rootDept) {
    throw new HttpError(409, 'Phòng ban của phụ lục phải khớp với hợp đồng gốc');
  }

  // custodianDept — cùng ràng buộc "1 đơn vị custodian xuyên suốt gốc + phụ lục" như dept ở trên (xem
  // giải thích ở createValidation.js contracts.extraValidate). Gửi chuỗi rỗng nghĩa là "bỏ chọn -> quay
  // lại mặc định đơn vị đang quản lý theo dõi", khớp đúng quy ước resolve lúc TẠO.
  if (payload.custodianDept !== undefined) {
    const newDept = payload.dept !== undefined ? payload.dept : contract.dept;
    payload.custodianDept = (payload.custodianDept && String(payload.custodianDept).trim()) || newDept;
  }
  if (!contract.isAddendum && hasAddenda && payload.custodianDept !== undefined && payload.custodianDept !== contract.custodianDept) {
    throw new HttpError(409, 'Hợp đồng gốc đã có phụ lục — không thể đổi đơn vị tiếp nhận theo dõi & thanh toán');
  }
  if (contract.isAddendum && rootCustodianDept !== undefined && payload.custodianDept !== undefined && payload.custodianDept !== rootCustodianDept) {
    throw new HttpError(409, 'Đơn vị tiếp nhận theo dõi & thanh toán của phụ lục phải khớp với hợp đồng gốc');
  }

  if (payload.startDate !== undefined || payload.endDate !== undefined) {
    const newStart = payload.startDate !== undefined ? payload.startDate : contract.startDate;
    const newEnd = payload.endDate !== undefined ? payload.endDate : contract.endDate;
    if (newStart && newEnd && newStart > newEnd) {
      throw new HttpError(400, 'Ngày hiệu lực phải trước ngày hết hạn');
    }
  }
  if (payload.amount !== undefined && !(Number(payload.amount) > 0)) {
    throw new HttpError(400, 'Giá trị hợp đồng phải lớn hơn 0');
  }
  // Đổi giá trị hợp đồng mà không đổi lại các đợt thanh toán đã khai (paymentInstallments) sẽ để lại
  // tổng đợt LỆCH với giá trị mới — y hệt lỗ hổng ở createValidation.js contracts.extraValidate (xem
  // ghi chú "Tổng các đợt thanh toán... phải khớp") nhưng chỉ được chặn lúc TẠO, chưa từng được kiểm
  // tra lại lúc SỬA. Cho phép gửi kèm paymentInstallments mới (client updateContractReq() gửi cùng
  // form) và validate lại đúng luật cũ; nếu KHÔNG gửi installments mới nhưng amount đổi khác số cũ và
  // đợt cũ đã khai (không phải mặc định "1 đợt = toàn bộ"), chặn để bắt buộc khai lại cho khớp.
  // Áp dụng cho CẢ hợp đồng gốc lẫn phụ lục — phụ lục cũng khai/sửa được đợt thanh toán của chính nó
  // trước khi được duyệt (xem createValidation.js — cùng luật lúc tạo).
  {
    const newAmount = payload.amount !== undefined ? Number(payload.amount) : contract.amount;
    let newInstallments = payload.paymentInstallments;
    if (newInstallments !== undefined) {
      newInstallments = (Array.isArray(newInstallments) ? newInstallments : []).map(it => ({
        description: (it?.description || '').trim(), amount: Number(it?.amount) || 0, dueDate: it?.dueDate || ''
      }));
      if (newInstallments.length) {
        if (newInstallments.some(it => !(it.amount > 0))) {
          throw new HttpError(400, 'Mỗi đợt thanh toán phải có số tiền lớn hơn 0');
        }
        const sum = newInstallments.reduce((s, it) => s + it.amount, 0);
        if (Math.abs(sum - newAmount) > 1) {
          throw new HttpError(400, `Tổng các đợt thanh toán (${sum.toLocaleString('vi-VN')}) phải khớp với giá trị hợp đồng (${newAmount.toLocaleString('vi-VN')})`);
        }
      }
      payload.paymentInstallments = newInstallments;
    } else if (payload.amount !== undefined && newAmount !== contract.amount && (contract.paymentInstallments || []).length) {
      throw new HttpError(409, 'Giá trị hợp đồng thay đổi — vui lòng khai lại các đợt thanh toán cho khớp');
    }
  }

  const endDateChanged = typeof payload.endDate === 'string' && contract.endDate !== payload.endDate;
  // Hợp đồng GỐC (chưa có phụ lục — đã chặn đổi dept khi CÓ phụ lục ở trên) được phép đổi dept, nhưng
  // effectiveSteps/effectiveApprovers (người/bước duyệt thật) đã được snapshot 1 LẦN lúc tạo theo dept
  // CŨ và resolveContractApprovalWorkflow() (workflowEngine.js) luôn ưu tiên dùng lại snapshot này nếu
  // đã có — không có gì dựng lại theo dept MỚI, khiến hồ sơ mang dept mới nhưng vẫn được duyệt bởi
  // người của phòng ban cũ. Dựng lại đúng như lúc TẠO (buildEffectiveContractApprovalWorkflowServer),
  // giữ nguyên các lớp phê duyệt tuỳ chọn/người đã chọn trước đó (selectedApprovalLayers/
  // selectedLayerMembers) và Cấp Phê Duyệt Cuối Cùng (approvalLevel) — chỉ đổi phần quy trình phòng ban.
  const deptChanged = !contract.isAddendum && payload.dept !== undefined && payload.dept !== contract.dept;
  for (const field of CONTRACT_EDITABLE_FIELDS) {
    if (payload[field] !== undefined) contract[field] = payload[field];
  }
  if (deptChanged && appData) {
    const effectiveWf = buildEffectiveContractApprovalWorkflowServer(
      contract.dept, contract.selectedApprovalLayers, contract.selectedLayerMembers, appData, contract.approvalLevel
    );
    contract.effectiveSteps = effectiveWf.steps;
    contract.effectiveApprovers = effectiveWf.approvers;
  }
  if (payload.paymentInstallments !== undefined) {
    contract.paymentInstallments = payload.paymentInstallments;
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
  // Hồ sơ đã bị TỪ CHỐI (REJECTED) hoặc trả về sửa (DRAFT, do REQUEST_CHANGES ở 1 bước duyệt) trước
  // đây SỬA XONG vẫn treo nguyên ở trạng thái đó — không có đường nào khác đưa hồ sơ về hàng chờ, nội
  // dung tuy đã sửa đúng theo góp ý nhưng chẳng ai duyệt tiếp/duyệt lại được nữa (kẹt vĩnh viễn). Sửa
  // xong thì coi như nộp lại từ đầu quy trình duyệt (currentStep=1), khớp đúng hành vi resubmit-from-
  // scratch mà REQUEST_CHANGES đã dùng cho các module khác (xem lib/workflowEngine.js).
  if (contract.approvalStatus === 'REJECTED' || contract.approvalStatus === 'DRAFT') {
    // Mọi lượt "APPROVED" đã ghi ở vòng nộp TRƯỚC (VD bước 1 có 2 đồng duyệt, 1 người đã duyệt trước
    // khi người kia từ chối) không còn giá trị cho vòng MỚI vì nội dung đã sửa — đánh dấu invalidated
    // giống hệt cách REQUEST_CHANGES đã làm cho vpp/submissions (xem workflowEngine.js) để
    // getStepApprovedUsernames()/canApproveStep() không tính nhầm là "đã duyệt bước này rồi" (kẹt hồ
    // sơ vĩnh viễn) hoặc coi phê duyệt CŨ (chưa từng thấy nội dung đã sửa) vẫn còn hiệu lực cho bước 1
    // của vòng MỚI (bỏ qua bước duyệt).
    (contract.history || []).forEach(h => { if (h.action === 'APPROVED') h.invalidated = true; });
    contract.approvalStatus = 'PENDING';
    contract.currentStep = 1;
  }
  return contract;
}

// ===================== "BỔ SUNG" cho Tài Liệu / Đăng Ký Xe / Mua Bán-Sửa Chữa-Đầu Tư / Văn Bản Trình =====================
// Khi người duyệt bước hiện tại bấm "Bổ Sung" (REQUEST_CHANGES — xem lib/workflowEngine.js
// MODULE_CONFIGS), hồ sơ bị đưa về NHÁP (status/currentStep reset về 0). 4 cặp hàm dưới đây (theo
// đúng khuôn updateVppRegistrationDraft()/submitVppRegistration() và updateBudgetEntryDraft()/
// submitBudgetEntry() đã có) cho phép CHÍNH NGƯỜI TẠO/TẢI LÊN (không mở rộng cho admin — khớp
// editContract() ở trên, chỉ đúng người tạo mới sửa) sửa lại TOÀN BỘ nội dung đã trình (kể cả tệp đính
// kèm, nếu module có) trong lúc còn NHÁP, rồi "Gửi Lại" để vào lại hàng chờ duyệt TỪ BƯỚC 1. Viết
// riêng (không dùng chung 1 engine) vì 4 module này (khác VPP/Ngân Sách) vốn KHÔNG có khái niệm NHÁP
// trước khi có "Bổ Sung" — tạo xong là vào PENDING ngay (xem lib/createValidation.js).
function resetForResubmit(item, cfg) {
  const statusField = cfg?.statusField || 'status';
  const currentStepField = cfg?.currentStepField || 'currentStep';
  const historyField = cfg?.historyField || 'history';
  // Mọi lượt "APPROVED" đã ghi ở vòng nộp TRƯỚC không còn giá trị cho vòng MỚI (nội dung đã sửa) —
  // đánh dấu invalidated giống hệt REQUEST_CHANGES (lib/workflowEngine.js)/editContract() ở trên, để
  // getStepApprovedUsernames()/canApproveStep() không tính nhầm "đã duyệt bước này rồi" (kẹt hồ sơ
  // vĩnh viễn) hay coi phê duyệt CŨ vẫn còn hiệu lực cho vòng MỚI.
  (item[historyField] || []).forEach(h => { if (h.action === 'APPROVED') h.invalidated = true; });
  item[statusField] = 'PENDING';
  item[currentStepField] = 1;
  if (!item[historyField]) item[historyField] = [];
}

// Đổi phòng ban lúc sửa NHÁP-bổ-sung PHẢI vẫn nằm trong đúng phạm vi được tạo hồ sơ của người này
// (getScope() ở CREATE_MODULE_CONFIGS lúc TẠO) — không thì 1 request tự soạn có thể lợi dụng vòng "bổ
// sung" để đổi hồ sơ sang phòng ban mình không có quyền tạo/tải lên, việc mà server đã chặn kỹ lúc TẠO
// (validateAndPrepareCreate) nhưng 4 hàm sửa-nháp mới này lại KHÔNG tự nhiên có cùng lớp kiểm tra đó.
function assertDeptScopeAllowed(user, scope, newDept) {
  if (!scopeAllows(user, scope, newDept)) {
    throw new HttpError(403, `Bạn không có quyền chuyển hồ sơ sang phòng ban "${newDept}"`);
  }
}

// ----- Tài Liệu (docs) -----
const DOC_DRAFT_EDITABLE_FIELDS = ['dept', 'cat', 'title', 'ver', 'summary', 'customData'];

function editDocDraft(payload, user, item) {
  if (item.uploader !== user.username) throw new HttpError(403, 'Chỉ người tải lên mới được sửa tài liệu này');
  if (item.status !== 'DRAFT') throw new HttpError(409, 'Tài liệu này không ở trạng thái cần bổ sung, không thể sửa');
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Thiếu dữ liệu cập nhật');
  if (payload.dept !== undefined && payload.dept !== item.dept) {
    assertDeptScopeAllowed(user, { all: !!user.perms?.uploadAll, depts: user.perms?.uploadDepts || [] }, payload.dept);
  }
  for (const f of DOC_DRAFT_EDITABLE_FIELDS) {
    if (payload[f] !== undefined) item[f] = payload[f];
  }
  if (!String(item.title || '').trim()) throw new HttpError(400, 'Thiếu tiêu đề tài liệu');
  // Cho phép thay thế hẳn tệp đính kèm (khác itPriceApprovals — CHỈ module đó bị khoá append-only theo
  // đúng yêu cầu nghiệp vụ, xem requestPriceInfoFromIt()/submitPriceSupplementFile() bên dưới).
  if (payload.fileUrl !== undefined) {
    if (!payload.fileUrl || !payload.fileName) throw new HttpError(400, 'Thiếu tệp tài liệu');
    item.fileName = payload.fileName;
    item.fileType = payload.fileType;
    item.fileUrl = payload.fileUrl;
  }
  item.lastEditedBy = user.username;
  item.lastEditedAt = nowVN();
  return item;
}

function submitDocDraft(user, item) {
  if (item.uploader !== user.username) throw new HttpError(403, 'Chỉ người tải lên mới được gửi lại tài liệu này');
  if (item.status !== 'DRAFT') throw new HttpError(409, 'Tài liệu này không ở trạng thái cần bổ sung (có thể đã gửi lại rồi)');
  item.history = item.history || [];
  item.history.push({ step: 0, stepName: 'Gửi lại sau bổ sung', approver: user.name, username: user.username, action: 'RESUBMITTED', comment: '', time: nowVN() });
  resetForResubmit(item, {});
  return item;
}

// ----- Đăng Ký Xe (carRegs) -----
const CAR_REG_DRAFT_EDITABLE_FIELDS = ['dept', 'type', 'passengers', 'directUser', 'directUserPhone', 'purpose', 'km', 'reason', 'customData'];

function editCarRegDraft(payload, user, item) {
  if (item.creator !== user.username) throw new HttpError(403, 'Chỉ người tạo phiếu mới được sửa phiếu đăng ký xe này');
  if (item.status !== 'DRAFT') throw new HttpError(409, 'Phiếu đăng ký xe này không ở trạng thái cần bổ sung, không thể sửa');
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Thiếu dữ liệu cập nhật');
  if (payload.dept !== undefined && payload.dept !== item.dept) {
    assertDeptScopeAllowed(user, user.perms?.carCreate, payload.dept);
  }
  for (const f of CAR_REG_DRAFT_EDITABLE_FIELDS) {
    if (payload[f] !== undefined) item[f] = payload[f];
  }
  if (payload.km !== undefined && Number(item.km) < 0) throw new HttpError(400, 'Số KM dự kiến không được là số âm');
  if (payload.startTime !== undefined || payload.endTime !== undefined) {
    if (payload.startTime !== undefined) item.startTime = payload.startTime;
    if (payload.endTime !== undefined) item.endTime = payload.endTime;
    const newStart = new Date(item.startTime).getTime();
    const newEnd = new Date(item.endTime).getTime();
    if (!Number.isFinite(newStart) || !Number.isFinite(newEnd)) throw new HttpError(400, 'Thời gian bắt đầu/kết thúc không hợp lệ');
    if (newStart >= newEnd) throw new HttpError(400, 'Thời gian kết thúc phải sau thời gian bắt đầu');
  }
  if (payload.routePoints !== undefined) {
    const points = (Array.isArray(payload.routePoints) ? payload.routePoints : []).map(p => String(p || '').trim()).filter(Boolean);
    if (points.length < 2) throw new HttpError(400, 'Vui lòng nhập ít nhất Điểm xuất phát và 1 điểm đến');
    item.routePoints = points;
    item.destination = points.join(' → ');
  }
  return item;
}

function submitCarRegDraft(user, item) {
  if (item.creator !== user.username) throw new HttpError(403, 'Chỉ người tạo phiếu mới được gửi lại phiếu đăng ký xe này');
  if (item.status !== 'DRAFT') throw new HttpError(409, 'Phiếu đăng ký xe này không ở trạng thái cần bổ sung (có thể đã gửi lại rồi)');
  item.history = item.history || [];
  item.history.push({ step: 0, approver: user.name, username: user.username, action: 'RESUBMITTED', comment: '', time: nowVN() });
  resetForResubmit(item, {});
  return item;
}

// ----- Mua Bán / Sửa Chữa / Đầu Tư (officeReqs) -----
// subType KHÔNG cho đổi lúc sửa (khác các field còn lại) — đổi subType đổi luôn cả bộ quy trình duyệt
// tra cứu (OFFICE_SUBTYPE_TO_DBKEY ở lib/workflowEngine.js) lẫn quyền tạo (officeBuy/officeFix/
// officeInvest), rủi ro hơn nhiều so với lợi ích, và nghiệp vụ "bổ sung" chỉ cần sửa lại NỘI DUNG đã
// trình, không phải đổi loại đề xuất.
const OFFICE_REQ_DRAFT_EDITABLE_FIELDS = ['dept', 'title', 'qty', 'supplier', 'usageTime', 'reason', 'customData'];

function editOfficeReqDraft(payload, user, item) {
  if (item.creator !== user.username) throw new HttpError(403, 'Chỉ người tạo mới được sửa đề xuất văn phòng này');
  if (item.status !== 'DRAFT') throw new HttpError(409, 'Đề xuất này không ở trạng thái cần bổ sung, không thể sửa');
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Thiếu dữ liệu cập nhật');
  if (payload.dept !== undefined && payload.dept !== item.dept) {
    assertDeptScopeAllowed(user, user.perms?.officeCreate, payload.dept);
  }
  for (const f of OFFICE_REQ_DRAFT_EDITABLE_FIELDS) {
    if (payload[f] !== undefined) item[f] = payload[f];
  }
  // Khớp đúng luật tính lại amount từ items ở createValidation.js CREATE_MODULE_CONFIGS.officeReqs
  // (không tin amount client tự tính) — chỉ áp dụng nhánh "Mua Sắm" (có items), nhánh Sửa Chữa/Đầu Tư
  // nhập tay 1 ô số vẫn phải chặn âm.
  if (payload.items !== undefined) {
    const validItems = (Array.isArray(payload.items) ? payload.items : []).map(it => {
      const qty = Number(it?.qty) || 0;
      const unitPrice = Number(it?.unitPrice) || 0;
      if (qty < 0 || unitPrice < 0) throw new HttpError(400, `Hạng mục "${it?.name || ''}": Số lượng/Đơn giá không được là số âm`);
      return { ...it, qty, unitPrice, amount: qty * unitPrice };
    });
    item.items = validItems;
    item.amount = validItems.reduce((sum, it) => sum + it.amount, 0);
  } else if (payload.amount !== undefined) {
    item.amount = Number(payload.amount) || 0;
  }
  if (item.amount < 0) throw new HttpError(400, 'Dự toán/Tổng chi phí không được là số âm');
  return item;
}

function submitOfficeReqDraft(user, item) {
  if (item.creator !== user.username) throw new HttpError(403, 'Chỉ người tạo mới được gửi lại đề xuất văn phòng này');
  if (item.status !== 'DRAFT') throw new HttpError(409, 'Đề xuất này không ở trạng thái cần bổ sung (có thể đã gửi lại rồi)');
  item.history = item.history || [];
  item.history.push({ step: 0, approver: user.name, username: user.username, action: 'RESUBMITTED', comment: '', time: nowVN() });
  resetForResubmit(item, {});
  return item;
}

// ----- Văn Bản Trình (submissions) -----
// Khác 3 module trên: có thể đổi type/dept/"Cấp Phê Duyệt Cuối Cùng"/lớp phê duyệt bổ sung khi sửa —
// PHẢI dựng lại effectiveSteps/effectiveApprovers giống hệt lúc TẠO (buildEffectiveSubmissionWorkflowServer),
// không tin nguyên effectiveSteps/effectiveApprovers cũ nếu các lựa chọn này đổi.
const SUBMISSION_DRAFT_EDITABLE_FIELDS = ['dept', 'type', 'title', 'priority', 'content', 'customData'];

function editSubmissionDraft(payload, user, item, appData) {
  if (item.creator !== user.username) throw new HttpError(403, 'Chỉ người trình mới được sửa tờ trình này');
  if (item.status !== 'DRAFT') throw new HttpError(409, 'Tờ trình này không ở trạng thái cần bổ sung, không thể sửa');
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Thiếu dữ liệu cập nhật');
  if (payload.dept !== undefined && payload.dept !== item.dept) {
    assertDeptScopeAllowed(user, user.perms?.submissionCreate, payload.dept);
  }
  for (const f of SUBMISSION_DRAFT_EDITABLE_FIELDS) {
    if (payload[f] !== undefined) item[f] = payload[f];
  }
  if (!String(item.title || '').trim()) throw new HttpError(400, 'Thiếu tiêu đề tờ trình');
  // Tệp chính: cho phép thay thế hẳn (khác itPriceApprovals). Tài liệu bổ sung (extraFiles[]) cho phép
  // gửi lại NGUYÊN danh sách mới (thêm/bớt tự do) — đây là tờ trình đang NHÁP để sửa lại, không phải
  // append-only như itPriceApprovals.
  if (payload.fileUrl !== undefined) {
    item.fileName = payload.fileName || '';
    item.fileType = payload.fileType || '';
    item.fileUrl = payload.fileUrl || '';
  }
  if (payload.extraFiles !== undefined) {
    item.extraFiles = Array.isArray(payload.extraFiles) ? payload.extraFiles : [];
  }
  const approvalLevel = payload.approvalLevel !== undefined ? payload.approvalLevel : item.approvalLevel;
  const selectedLayerKeys = payload.selectedApprovalLayers !== undefined ? payload.selectedApprovalLayers : item.selectedApprovalLayers;
  const selectedLayerMembers = payload.selectedLayerMembers !== undefined ? payload.selectedLayerMembers : item.selectedLayerMembers;
  if (!SUBMISSION_APPROVAL_LEVELS.includes(approvalLevel)) throw new HttpError(400, `Cấp phê duyệt cuối cùng không hợp lệ: ${approvalLevel}`);
  const effectiveWf = buildEffectiveSubmissionWorkflowServer(item.type, item.dept, selectedLayerKeys, selectedLayerMembers, appData || {}, approvalLevel);
  item.approvalLevel = approvalLevel;
  item.selectedApprovalLayers = effectiveWf.layerKeys;
  item.selectedLayerMembers = selectedLayerMembers || {};
  item.effectiveSteps = effectiveWf.steps;
  item.effectiveApprovers = effectiveWf.approvers;
  item.opinionRequestees = effectiveWf.opinionRequestees;
  return item;
}

function submitSubmissionDraft(user, item) {
  if (item.creator !== user.username) throw new HttpError(403, 'Chỉ người trình mới được gửi lại tờ trình này');
  if (item.status !== 'DRAFT') throw new HttpError(409, 'Tờ trình này không ở trạng thái cần bổ sung (có thể đã gửi lại rồi)');
  item.history = item.history || [];
  item.history.push({ step: 0, approver: user.name, username: user.username, action: 'RESUBMITTED', comment: 'Đã sửa lại và trình lại sau khi được yêu cầu bổ sung', time: nowVN() });
  resetForResubmit(item, {});
  return item;
}

// Duyệt/từ chối hợp đồng GỐC hoặc phụ lục — GIỜ đi qua quy trình Phê Duyệt HĐ theo bước (xem
// lib/workflowEngine.js MODULE_CONFIGS.contracts + routes/workflow.js POST /api/workflow/contracts/:id/
// approve|reject), KHÔNG còn là 1 cờ quyền phẳng contractApprove nữa — bỏ hẳn canApproveContract()/
// approveContract()/rejectContract() ở đây (trước là flat-permission, không có khái niệm bước/phòng ban).

// Upload "Tài liệu ký" (bản cứng đã ký) + bấm nút "Thanh toán" — theo phạm vi quyền contractCreate CỦA
// ĐÚNG ĐƠN VỊ TIẾP NHẬN THEO DÕI & THANH TOÁN (custodianDept, khớp getScope() ở
// CREATE_MODULE_CONFIGS.contracts) — KHÔNG còn theo contract.dept (phòng ban tạo/quản lý hồ sơ) như
// trước, vì custodianDept mới là đơn vị được giao "upload hợp đồng, phụ lục hợp đồng ký bên ta quản lý
// và theo dõi hợp đồng & giấy phép" theo đúng yêu cầu nghiệp vụ. "|| contract.dept" là lớp phòng vệ cho
// hồ sơ ĐÃ TỒN TẠI TRƯỚC khi triển khai tính năng này (custodianDept chưa từng có, chắc chắn undefined
// trong dữ liệu cũ) — createValidation.js chỉ resolve custodianDept = dept cho hồ sơ TẠO/SỬA MỚI từ nay
// trở đi, không có gì tự điền lại cho hồ sơ cũ đang nằm sẵn trong DB; không có fallback này, hồ sơ cũ sẽ
// đột ngột không ai thao tác được nữa (scopeAllows(..., undefined) luôn trả false trừ khi admin/scope.all).
function canManageContractPayment(user, contract) {
  return !!(user.perms?.admin || scopeAllows(user, user.perms?.contractCreate, contract.custodianDept || contract.dept));
}

function uploadContractSignedFile(payload, user, contract) {
  // Phụ lục CŨNG có "Tài liệu ký" + luồng thanh toán riêng của chính nó (độc lập với hợp đồng gốc) —
  // trước đây chặn cứng contract.isAddendum, khiến phụ lục đã duyệt xong không có cách nào hoàn tất hồ
  // sơ lưu trữ "Phụ lục hợp đồng đã ký".
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

// Kế toán có thể SỬA LẠI các đợt thanh toán đề xuất (lấy tham khảo từ Hợp đồng/Mua Bán/Sửa Chữa/Đầu
// Tư) NGAY LÚC tạo đề nghị thanh toán có nguồn, thay vì phải tạo xong rồi mới sửa qua editPaymentRequest()
// — trả về null nếu không override gì (giữ nguyên hành vi mặc định cũ của startContractPayment()/
// startOfficePayment()), khớp đúng luật "mỗi đợt phải dương" như paymentRequests.extraValidate ở
// createValidation.js (tạo thủ công) để 2 đường tạo đề nghị thanh toán không lệch luật nhau.
function normalizePaymentInstallmentsOverride(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const installments = raw.map(it => ({
    description: (it?.description || '').trim(), amount: Number(it?.amount) || 0, dueDate: it?.dueDate || '',
    confirmed: false, confirmedAt: null, confirmedBy: null
  }));
  if (installments.some(it => !(it.amount > 0))) {
    throw new HttpError(400, 'Mỗi đợt thanh toán phải có số tiền lớn hơn 0');
  }
  return installments;
}

// Chuyển hợp đồng sang "Chờ thanh toán" + trả về BẢN NHÁP đề nghị thanh toán (CHƯA lưu — route gọi
// createForCollection('paymentRequests', ...) ngay sau khi mutatorFn này chạy xong, cùng khuôn với
// assignMinutesTasks()/insertMinutesTasks() ở routes/records.js).
// overrides (tuỳ chọn, {installments, title, skipManageGate}) — dùng khi kế toán tự khởi tạo đề nghị
// thanh toán từ module Thanh Toán (xem POST /api/records/paymentRequests/from-source ở
// routes/records.js), cho phép sửa lại đợt thanh toán/tên đề nghị tham khảo từ hợp đồng trước khi gửi.
// skipManageGate=true bỏ qua canManageContractPayment() bên dưới — route from-source đã tự gác bằng
// paymentManage RIÊNG (kế toán tạo đề nghị có nguồn không nhất thiết thuộc đơn vị custodian của hợp
// đồng, khác hẳn nút "Chuyển Sang Thanh Toán" ngay trong module Hợp Đồng vẫn PHẢI đúng đơn vị custodian
// — xem route đó vẫn gọi hàm này KHÔNG kèm overrides nên giữ nguyên gác cổng cũ). Các điều kiện còn lại
// (đã có Tài liệu ký đã duyệt, chưa thanh toán) áp dụng như nhau cho CẢ 2 đường.
function startContractPayment(user, contract, overrides) {
  // Phụ lục có thể phát sinh thanh toán riêng (VD bổ sung khối lượng/giá trị) — chuyển sang thanh toán
  // độc lập với hợp đồng gốc, sourceId/sourceCode dưới đây luôn theo ĐÚNG bản ghi (gốc hay phụ lục)
  // đang gọi hàm này, nên "Xác nhận đề nghị thanh toán" hiện đúng 2 dòng tách biệt khi cả 2 cùng có đợt
  // thanh toán đang chờ.
  if (!overrides?.skipManageGate && !canManageContractPayment(user, contract)) throw new HttpError(403, 'Bạn không có quyền chuyển hợp đồng này sang thanh toán');
  if (!contract.signedFileUrl) throw new HttpError(409, 'Cần tải lên Tài liệu ký trước khi chuyển sang thanh toán');
  if (contract.signedFileStatus !== 'APPROVED') throw new HttpError(409, 'Tài liệu ký cần được phê duyệt trước khi chuyển sang thanh toán');
  if (contract.paymentStatus !== 'CHUA_THANH_TOAN') throw new HttpError(409, 'Hợp đồng không ở trạng thái chưa thanh toán');
  contract.paymentStatus = 'CHO_THANH_TOAN';
  const overrideInstallments = normalizePaymentInstallmentsOverride(overrides?.installments);
  const installments = overrideInstallments || buildPaymentInstallments(contract.paymentInstallments, contract.amount, 'Thanh toán toàn bộ giá trị hợp đồng');
  return {
    sourceModule: 'CONTRACT', sourceId: contract.id, sourceCode: contract.code,
    // Đề nghị thanh toán mang dept của ĐƠN VỊ CUSTODIAN (đơn vị đang thao tác chuyển sang thanh toán,
    // đã xác thực qua canManageContractPayment() ở trên) — không phải contract.dept gốc, để kế toán
    // thấy đúng đơn vị chịu trách nhiệm theo dõi khoản thanh toán này. Fallback "|| contract.dept" cho
    // hồ sơ cũ trước khi có custodianDept (xem giải thích ở canManageContractPayment()).
    dept: contract.custodianDept || contract.dept,
    title: (overrides?.title && String(overrides.title).trim()) || contract.title,
    // amount đi theo TỔNG các đợt thực tế gửi lên khi có override (khớp luật tạo thủ công) — không
    // còn khoá cứng contract.amount, vì override cho phép kế toán khai lại khác giá trị tham khảo gốc.
    amount: overrideInstallments ? installments.reduce((s, it) => s + it.amount, 0) : contract.amount,
    installments,
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
  // Khác Hợp đồng (có quy trình duyệt riêng cho Tài liệu ký, khoá lại khi signedFileStatus==='APPROVED'),
  // officeReqs không có bước duyệt phụ cho tài liệu ký — tệp gắn vào là dùng làm căn cứ thanh toán ngay.
  // Vẫn cho tải lại/sửa TRƯỚC KHI bắt đầu chuyển sang thanh toán (paymentStatus vẫn CHUA_THANH_TOAN, vd
  // lỡ chọn nhầm tệp), nhưng khoá cứng ngay khi đã "Chuyển Sang Thanh Toán" hoặc đã thanh toán xong —
  // trước đây không có điều kiện này, tệp căn cứ thanh toán bị thay được ngay cả sau khi tiền đã giải
  // ngân xong (paymentStatus === 'DA_THANH_TOAN').
  if (item.signedFileUrl && item.paymentStatus !== 'CHUA_THANH_TOAN') {
    throw new HttpError(409, 'Đã chuyển sang thanh toán — không thể thay đổi Tài liệu ký nữa');
  }
  const { fileName, fileType, fileUrl } = payload || {};
  if (!fileName || !fileUrl) throw new HttpError(400, 'Thiếu tệp tài liệu ký');
  item.signedFileName = fileName;
  item.signedFileType = fileType;
  item.signedFileUrl = fileUrl;
  item.signedUploadedBy = user.username;
  item.signedUploadedAt = nowVN();
  return item;
}

// overrides — cùng ý nghĩa như startContractPayment() ở trên (skipManageGate bỏ qua canManageOfficePayment()).
function startOfficePayment(user, item, overrides) {
  if (!overrides?.skipManageGate && !canManageOfficePayment(user, item)) throw new HttpError(403, 'Bạn không có quyền chuyển đề xuất này sang thanh toán');
  if (!item.signedFileUrl) throw new HttpError(409, 'Cần tải lên Tài liệu ký trước khi chuyển sang thanh toán');
  if (item.paymentStatus !== 'CHUA_THANH_TOAN') throw new HttpError(409, 'Đề xuất không ở trạng thái chưa thanh toán');
  item.paymentStatus = 'CHO_THANH_TOAN';
  const overrideInstallments = normalizePaymentInstallmentsOverride(overrides?.installments);
  const installments = overrideInstallments || buildPaymentInstallments(null, item.amount, 'Thanh toán toàn bộ giá trị đề xuất');
  return {
    sourceModule: item.subType, sourceId: item.id, sourceCode: item.code,
    dept: item.dept,
    title: (overrides?.title && String(overrides.title).trim()) || item.title,
    amount: overrideInstallments ? installments.reduce((s, it) => s + it.amount, 0) : item.amount,
    installments,
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
  // Khớp đúng luật lúc TẠO (xem createValidation.js CREATE_MODULE_CONFIGS.paymentRequests) — "Cần ít
  // nhất 1 đợt thanh toán" chỉ được kiểm tra lúc tạo, chưa từng được kiểm tra lại lúc sửa: xoá hết các
  // đợt trong form Sửa rồi lưu để lại 1 đề nghị thanh toán installments=[] amount=0, không đợt nào để
  // xác nhận (confirmPaymentInstallment() không có gì lặp qua) -> đề nghị thanh toán kẹt vĩnh viễn ở
  // APPROVED, không bao giờ tự chuyển PAID được.
  if (payload.installments !== undefined) {
    const installments = Array.isArray(payload.installments) ? payload.installments : [];
    if (!installments.length) throw new HttpError(400, 'Cần ít nhất 1 đợt thanh toán');
    // Mỗi đợt phải dương — cùng lý do lúc TẠO (xem createValidation.js paymentRequests.extraValidate).
    if (installments.some(it => !(Number(it?.amount) > 0))) {
      throw new HttpError(400, 'Mỗi đợt thanh toán phải có số tiền lớn hơn 0');
    }
  }
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
  // NEED_INFO KHÔNG được duyệt trực tiếp — phải qua editPaymentRequest() (nút "Sửa & Gửi lại") để tự
  // chuyển về PENDING trước, khớp đúng bước "phản hồi yêu cầu bổ sung" bắt buộc như Văn Bản Trình.
  // Trước đây cho duyệt thẳng từ NEED_INFO khiến bước "Yêu cầu bổ sung" chỉ mang tính hình thức.
  if (pr.status !== 'PENDING') throw new HttpError(409, 'Đề nghị thanh toán không ở trạng thái chờ duyệt');
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

  // Dòng chỉ đạo đã "Giao việc" (taskCreated=true) đã sinh ra 1 Công Việc THẬT (buildTasksFromDirectives()
  // ở trên) — hệ thống KHÔNG có cơ chế đồng bộ lại Công Việc khi biên bản đổi sau đó, nên PHẢI giữ
  // nguyên nội dung/người thực hiện của dòng đó (kể cả Admin), tránh Công Việc bị lệch khỏi biên bản.
  // Chỉ đạo ĐÃ có id ổn định từ trước -> tra theo ĐÚNG id đó (vị trí có thể đổi nếu dòng khác bị xoá/
  // chèn). Chỉ đạo cũ CHƯA có id (biên bản tạo trước khi có tính năng này) -> tra theo ĐÚNG vị trí cũ,
  // khớp quy ước Task.sourceDirectiveId đã sinh ra ở buildTasksFromDirectives() phía trên — KHÔNG được
  // so khớp bằng 1 khoá "id nếu có, else vị trí" tính LẠI trên cả 2 phía (bug cũ): phía mới thường đã tự
  // bù id ổn định ngay khi mở Sửa (xem openEditMeetingMinutes() ở index.html) dù phía cũ chưa từng có,
  // khiến khoá 2 bên lệch nhau ngay cả khi không ai đổi gì, và bị từ chối lưu như thể đang xoá dòng đó.
  const directiveIdMigrations = [];
  if (payload.directives !== undefined) {
    const newDirectives = Array.isArray(payload.directives) ? payload.directives : [];
    const newById = new Map(newDirectives.filter(d => d.id != null).map(d => [d.id, d]));
    (minutes.directives || []).forEach((old, idx) => {
      if (!old.taskCreated) return;
      const next = old.id != null ? newById.get(old.id) : newDirectives[idx];
      if (!next) throw new HttpError(409, 'Không thể xoá dòng chỉ đạo đã giao việc');
      if (next.content !== old.content || next.assignedToAttendeeId !== old.assignedToAttendeeId) {
        throw new HttpError(409, 'Không thể sửa nội dung/người thực hiện của dòng chỉ đạo đã giao việc');
      }
      // buildTasksFromDirectives() (đã dùng để tạo Task từ CHÍNH dòng chỉ đạo này) cũng lấy cả deadline
      // lẫn collaboratorAttendeeIds để gán vào Task — guard cũ chỉ chặn content/assignedToAttendeeId
      // (2/4 field thực sự ảnh hưởng tới Task đã tạo), để lọt sửa hạn/người phối hợp khiến Biên bản họp
      // và Công Việc thật lệch nhau vĩnh viễn (không có cơ chế đồng bộ lại, đúng như comment phía trên).
      if (next.deadline !== old.deadline) {
        throw new HttpError(409, 'Không thể sửa hạn hoàn thành của dòng chỉ đạo đã giao việc');
      }
      const oldCollab = JSON.stringify([...(old.collaboratorAttendeeIds || [])].sort());
      const nextCollab = JSON.stringify([...(next.collaboratorAttendeeIds || [])].sort());
      if (oldCollab !== nextCollab) {
        throw new HttpError(409, 'Không thể sửa người phối hợp của dòng chỉ đạo đã giao việc');
      }
      // Chỉ đạo lần đầu được bù id ổn định (old.id null -> next.id có giá trị) trong khi ĐÃ có Công Việc
      // tham chiếu theo VỊ TRÍ cũ -> phải viết lại Task.sourceDirectiveId sang id mới (xem
      // migrateDirectiveTaskLinks() ở lib/taskStore.js, route gọi ngay sau khi lưu biên bản thành công).
      // Không migrate thì "Xem chi tiết" (index.html, tra theo d.id nếu có, else vị trí) đổi sang tra
      // theo id ngay từ lần sửa này trong khi Task vẫn giữ vị trí cũ -> mất liên kết vĩnh viễn.
      if (old.id == null && next.id != null) {
        directiveIdMigrations.push({ oldSourceDirectiveId: idx, newSourceDirectiveId: next.id });
      }
    });
  }

  for (const field of MINUTES_EDITABLE_FIELDS) {
    if (payload[field] !== undefined) minutes[field] = payload[field];
  }
  minutes.lastEditedBy = user.username;
  minutes.lastEditedAt = nowVN();
  // "directiveIdMigrations" chỉ để route đọc và đồng bộ Task ngay sau khi lưu — KHÔNG thuộc bản ghi
  // biên bản, route phải tách field này ra trước khi coi phần còn lại là bản ghi cần lưu.
  return { ...minutes, directiveIdMigrations };
}

function assertCanDeleteMinutes(user, minutes) {
  if (!canDeleteMinutes(user, minutes)) {
    throw new HttpError(403, 'Bạn không có quyền xóa biên bản họp này');
  }
  // Biên bản đã "Giao việc" đã sinh Task thật (sourceType='MEETING_MINUTES', sourceCode=mã biên bản
  // này) — xoá biên bản không cascade các Task đó, để lại mồ côi vĩnh viễn (không còn "Xem chi tiết"
  // trỏ về nguồn); nghiêm trọng hơn, vì createMinutes() chỉ kiểm tra trùng mã trong collection HIỆN CÓ,
  // xoá xong cho phép tạo lại 1 biên bản KHÁC dùng đúng mã cũ — Task mồ côi có thể bị hiển thị/liên kết
  // nhầm sang biên bản mới không liên quan (so khớp theo sourceCode === m.code + sourceDirectiveId).
  if (minutes.tasksAssigned) {
    throw new HttpError(409, 'Biên bản này đã giao việc (đã sinh Công Việc thật) — không thể xoá');
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

// Reaction cho TỪNG bình luận (khác likes cấp bài viết ở trên) — dùng để xếp hạng "3-5 bình luận nổi
// bật" (mới nhất + nhiều reaction nhất) ở renderInternalNewsCard()/renderInternalPosts() phía client;
// server chỉ lưu likes[], KHÔNG tự xếp hạng (thuần hiển thị, tính lại mỗi lần render, không cache).
function toggleInternalPostCommentLike(user, post, commentId) {
  const comment = (post.comments || []).find(c => c.id === commentId);
  if (!comment) throw new HttpError(404, 'Không tìm thấy bình luận');
  if (!Array.isArray(comment.likes)) comment.likes = [];
  const idx = comment.likes.indexOf(user.username);
  if (idx === -1) comment.likes.push(user.username);
  else comment.likes.splice(idx, 1);
  return post;
}

// Chuẩn hoá để so khớp từ khoá nhạy cảm — bỏ dấu tiếng Việt (kể cả "đ/Đ", không có dạng phân rã NFD)
// + viết thường + gộp khoảng trắng, cùng khuôn normalizeHeader() ở lib/vppCatalog.js.
function normalizeForScan(s) {
  return String(s || '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Quét (KHÔNG chặn đăng) nội dung bình luận theo danh sách từ khoá admin tự cấu hình
// (DB.sensitiveKeywords, xem defaults.js) — chỉ gắn cờ để người có quyền internalPostApprove xem xét
// sau, quyết định cuối (bỏ qua/xoá) vẫn do người kiểm duyệt, không tự động xoá gì ở đây. Trả về mảng
// rỗng nếu không khớp từ nào.
function scanCommentForSensitiveContent(content, sensitiveKeywords) {
  const normalized = normalizeForScan(content);
  if (!normalized) return [];
  const hits = [];
  for (const kw of sensitiveKeywords || []) {
    const term = normalizeForScan(kw.term);
    if (term && normalized.includes(term)) hits.push({ term: kw.term, category: kw.category });
  }
  return hits;
}

// sensitiveKeywords (mảng {term, category}, xem defaults.js) do routes/records.js đọc sẵn từ AppData
// và truyền vào — hàm ở đây không tự đọc DB (khớp nguyên tắc appData chỉ do caller đọc, xem
// lib/createValidation.js). Không truyền (undefined) thì bỏ qua bước quét, không gắn cờ gì (an toàn
// khi có nơi gọi cũ chưa kịp cập nhật).
function addInternalPostComment(payload, user, post, sensitiveKeywords) {
  const content = (payload?.content || '').trim();
  if (!content) throw new HttpError(400, 'Vui lòng nhập nội dung bình luận');
  if (!Array.isArray(post.comments)) post.comments = [];
  const comment = { id: Date.now(), username: user.username, name: user.name, content, time: nowVN() };
  const hits = scanCommentForSensitiveContent(content, sensitiveKeywords);
  if (hits.length) {
    comment.flagged = true;
    comment.flagCategories = [...new Set(hits.map(h => h.category))];
    comment.flagTerms = [...new Set(hits.map(h => h.term))];
    // Trước đây bình luận khớp từ khoá nhạy cảm vẫn hiển thị NGAY, chỉ gắn cờ để hậu kiểm. Đổi hành vi
    // theo yêu cầu: đưa thẳng vào "Chờ Kiểm Duyệt" — ẩn công khai (sanitizeInternalPostCommentsForUser ở
    // lib/recordViewScope.js lọc theo cờ này) cho tới khi người kiểm duyệt xử lý (dismiss = duyệt hiện,
    // delete = xoá hẳn) qua dismissInternalCommentFlag()/deleteInternalPostComment() bên dưới.
    comment.pendingModeration = true;
  }
  post.comments.push(comment);
  return post;
}

// Bỏ cờ cảnh báo (người kiểm duyệt xem xét thấy không có vấn đề gì) — không xoá bình luận, chỉ gỡ
// đánh dấu để hiện công khai trở lại (thoát khỏi hàng chờ kiểm duyệt).
function dismissInternalCommentFlag(user, post, commentId) {
  if (!canApproveInternalPost(user)) throw new HttpError(403, 'Bạn không có quyền kiểm duyệt bình luận');
  const comment = (post.comments || []).find(c => c.id === commentId);
  if (!comment) throw new HttpError(404, 'Không tìm thấy bình luận');
  comment.flagged = false;
  comment.flagCategories = [];
  comment.flagTerms = [];
  comment.pendingModeration = false;
  comment.flagDismissedBy = user.username;
  comment.flagDismissedAt = nowVN();
  return post;
}

// Xoá hẳn 1 bình luận (người kiểm duyệt xử lý bình luận vi phạm) — cho phép xoá bất kỳ bình luận nào,
// không chỉ bình luận đang bị đánh dấu (khớp quyền hạn chung canApproveInternalPost, tương tự admin
// xoá được mọi bình luận chứ không riêng bình luận do hệ thống tự phát hiện).
function deleteInternalPostComment(user, post, commentId) {
  if (!canApproveInternalPost(user)) throw new HttpError(403, 'Bạn không có quyền xoá bình luận này');
  const idx = (post.comments || []).findIndex(c => c.id === commentId);
  if (idx === -1) throw new HttpError(404, 'Không tìm thấy bình luận');
  post.comments.splice(idx, 1);
  return post;
}

// Khớp đúng registerForTraining() ở index.html: đã đăng ký rồi thì client tự bỏ qua từ trước khi gọi
// tới đây (không coi là lỗi) — server vẫn tự kiểm tra lại phòng khi dữ liệu client cũ/lệch (idempotent,
// không throw), chỉ chặn thật khi ĐÃ ĐỦ số lượng.
function registerInternalPostTraining(user, post) {
  if (post.type !== 'TRAINING' || !post.training) throw new HttpError(400, 'Bài đăng không phải khóa đào tạo');
  if (!Array.isArray(post.training.registeredUsers)) post.training.registeredUsers = [];
  if (post.training.registeredUsers.includes(user.username)) return post;
  // Trước đây KHÔNG kiểm tra hạn đăng ký — chỉ giao diện ẩn nút khi đã qua hạn, request tự soạn vẫn
  // đăng ký được sau khi hạn đăng ký đã qua. registerDeadline là input type="date" (YYYY-MM-DD) — so
  // sánh chuỗi ISO ngày (cùng khuôn period.endDate ở VPP/Báo Cáo), không dùng nowVN() (định dạng
  // dd/mm/yyyy tiếng Việt, so sánh chuỗi sai thứ tự).
  const todayStr = new Date().toISOString().slice(0, 10);
  if (post.training.registerDeadline && todayStr > post.training.registerDeadline) {
    throw new HttpError(409, 'Đã hết hạn đăng ký khóa đào tạo này');
  }
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

// "Yêu cầu bổ sung" cho Góc Chia Sẻ — CÙNG khuôn requestPaymentInfo() (module Thanh Toán) ở trên: chỉ
// chuyển PENDING -> NEED_INFO kèm lý do, người đăng phải quay lại sửa qua editInternalPost() (đưa về
// PENDING) mới duyệt lại được — không cho duyệt thẳng từ NEED_INFO (xem approveInternalPost ở trên vẫn
// chỉ nhận status PENDING, không cần sửa gì thêm).
function requestInternalPostInfo(payload, user, post) {
  if (!canApproveInternalPost(user)) throw new HttpError(403, 'Bạn không có quyền yêu cầu bổ sung');
  if (post.type !== 'SHARE') throw new HttpError(400, 'Chỉ áp dụng cho bài đăng Góc Chia Sẻ');
  if (post.status !== 'PENDING') throw new HttpError(409, 'Bài đăng không ở trạng thái chờ duyệt');
  const comment = (payload?.comment || '').trim();
  if (!comment) throw new HttpError(400, 'Vui lòng nhập nội dung cần bổ sung');
  post.status = 'NEED_INFO';
  post.infoRequestComment = comment;
  return post;
}

// Ẩn/Hiện bài viết đã đăng (Nháp/Chờ duyệt/Ẩn KHÔNG dùng hành động này — chỉ APPROVED<->HIDDEN, đúng
// "Admin chủ động ẩn khỏi trang chủ/chuyên mục" ở mô hình trạng thái đề xuất, KHÁC PENDING/REJECTED
// vốn là kết quả của bước duyệt nội dung).
function hideInternalPost(user, post) {
  if (!canApproveInternalPost(user)) throw new HttpError(403, 'Bạn không có quyền ẩn bài đăng này');
  if (post.status !== 'APPROVED') throw new HttpError(409, 'Chỉ ẩn được bài đã đăng');
  post.status = 'HIDDEN';
  post.hiddenBy = user.username;
  post.hiddenAt = nowVN();
  return post;
}

function unhideInternalPost(user, post) {
  if (!canApproveInternalPost(user)) throw new HttpError(403, 'Bạn không có quyền hiện lại bài đăng này');
  if (post.status !== 'HIDDEN') throw new HttpError(409, 'Bài đăng không ở trạng thái đã ẩn');
  post.status = 'APPROVED';
  post.hiddenBy = null;
  post.hiddenAt = null;
  return post;
}

// Sửa bài Nháp/bài bị "Yêu cầu bổ sung" (NEED_INFO) — chỉ tác giả (hoặc admin) sửa được, chỉ 2 trạng
// thái này sửa được (bài đã APPROVED/PENDING/REJECTED/HIDDEN đã qua giai đoạn soạn thảo). Gửi lại y hệt
// luật gán status lúc TẠO (xem createValidation.js internalPosts.extraValidate) — giữ isDraft để tác
// giả có thể lưu nháp nhiều lần trước khi thật sự gửi.
const INTERNAL_POST_EDITABLE_FIELDS = ['title', 'content', 'attachment', 'postCategory', 'publishAt', 'training'];
function editInternalPost(payload, user, post) {
  if (post.author !== user.username && !user.perms?.admin) throw new HttpError(403, 'Bạn không có quyền sửa bài đăng này');
  if (post.status !== 'DRAFT' && post.status !== 'NEED_INFO') throw new HttpError(409, 'Bài đăng không còn ở trạng thái được sửa');
  for (const field of INTERNAL_POST_EDITABLE_FIELDS) {
    if (payload[field] !== undefined) post[field] = payload[field];
  }
  if (post.type === 'NEWS' && post.publishAt) {
    const ts = new Date(post.publishAt).getTime();
    if (!Number.isFinite(ts)) throw new HttpError(400, 'Thời gian đăng bài không hợp lệ');
    post.publishAt = new Date(ts).toISOString();
  } else if (post.type !== 'NEWS') {
    post.publishAt = null;
  }
  if (payload.draft === true) {
    post.status = 'DRAFT';
  } else {
    post.status = (post.type === 'SHARE' && !user.perms?.admin && !user.perms?.internalPostApprove)
      ? 'PENDING' : 'APPROVED';
    post.infoRequestComment = null;
  }
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
  // Trước đây không kiểm tra công việc còn "chưa có người nhận" hay không — gọi thẳng API vẫn âm thầm
  // đổi người nhận của 1 việc đã có người đang làm dở (lịch sử/subtask cũ vẫn giữ nguyên của người cũ).
  if (task.assignedTo) {
    throw new HttpError(409, 'Công việc này đã có người nhận, không thể gán lại qua thao tác này');
  }
  // Khác editTask/requestExtension/cancelOrRequestCancelTask (đã chặn khi DONE/CANCELLED), assignTask()
  // trước đây không xét task.status — việc đã bị Huỷ (chưa có người nhận, vd chỉ đạo tự sinh) vẫn "Gán
  // người nhận" được sau đó, tự chuyển DOING, coi như chưa từng bị huỷ (phá vỡ giả định CANCELLED là
  // trạng thái kết thúc mà báo cáo/thống kê Công Việc đang dựa vào).
  if (task.status === 'DONE' || task.status === 'CANCELLED') {
    throw new HttpError(409, 'Công việc đã Hoàn thành/Đã huỷ — không thể gán người nhận');
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
  // Công việc đã Hoàn thành/Đã huỷ là trạng thái kết thúc — sửa lại tiêu đề/người nhận sau đó sẽ làm
  // lệch số liệu báo cáo của kỳ đã đóng mà không có dấu hiệu gì bất thường. Trước đây route submit
  // thật không tự kiểm tra lại (chỉ ẩn nút "Sửa" ở UI theo isOpenTask cho các nút KHÁC, riêng nút Sửa
  // không hề lọc theo trạng thái này).
  if (task.status === 'DONE' || task.status === 'CANCELLED') {
    throw new HttpError(409, 'Công việc đã Hoàn thành/Đã huỷ — không thể sửa lại');
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
  // Client chỉ hiện nút "Xác Nhận Tham Gia" khi isOpenTask (status khác DONE/CANCELLED) — cùng dạng
  // lỗ hổng "gate chỉ ở client" đã vá cho acceptTask()/requestExtension()/cancelOrRequestCancelTask(),
  // nhưng trước đây bị bỏ sót cho hàm này: gọi thẳng API sau khi việc đã đóng vẫn ghi thêm xác nhận
  // tham gia + dòng lịch sử vào 1 việc đã kết thúc, gây nhiễu khi tra cứu lịch sử.
  if (task.status === 'DONE' || task.status === 'CANCELLED') {
    throw new HttpError(409, 'Công việc đã Hoàn thành/Đã huỷ — không thể xác nhận tham gia');
  }
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
  // Khớp guard của addSubtask() — thiếu ở đây trước đây khiến việc đã Hoàn thành/Huỷ vẫn bật/tắt được
  // công việc nhỏ, âm thầm đổi trạng thái hoàn thành của 1 việc đã đóng.
  if (task.status !== 'DOING') {
    throw new HttpError(409, 'Chỉ cập nhật được công việc nhỏ khi việc chính đang thực hiện');
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
  if (task.status !== 'DOING') {
    throw new HttpError(409, 'Chỉ xoá được công việc nhỏ khi việc chính đang thực hiện');
  }
  const subtaskId = Number(payload?.subtaskId);
  const idx = (task.subtasks || []).findIndex(s => s.id === subtaskId);
  if (idx === -1) throw new HttpError(404, 'Không tìm thấy công việc nhỏ');
  const [removed] = task.subtasks.splice(idx, 1);
  task.history = Array.isArray(task.history) ? task.history : [];
  task.history.push({ action: 'SUBTASK_DELETED', by: user.username, byName: user.name, time: nowVN(), note: `Xoá công việc nhỏ "${removed.title}"` });
  return task;
}

// Chuyển trạng thái hợp lệ qua "Cập Nhật Tiến Độ" — khớp ĐÚNG các lựa chọn mà openTaskProgressModal()
// đưa ra ở client (TODO chỉ được sang DOING; DOING được ở lại DOING (chỉ ghi thêm tiến độ) hoặc sang
// DONE). Trước đây không whitelist gì cả và không kiểm tra task.status hiện tại — gọi thẳng API có
// thể "hồi sinh" 1 việc đã CANCELLED quay lại DOING/TODO, hoặc nhảy thẳng TODO->DONE bỏ qua bước Nhận
// Việc, hoặc gửi 1 chuỗi status tuỳ ý phá vỡ các chỗ đếm/thống kê theo status.
const TASK_STATUS_TRANSITIONS = { TODO: ['DOING'], DOING: ['DOING', 'DONE'] };

function updateTaskStatusAction(payload, user, task) {
  if (task.assignedTo !== user.username && task.assignedBy !== user.username && !user.perms?.admin) {
    throw new HttpError(403, 'Bạn không có quyền cập nhật công việc này!');
  }
  const newStatus = payload?.newStatus;
  if (!newStatus) throw new HttpError(400, 'Thiếu trạng thái mới');
  const allowedNext = TASK_STATUS_TRANSITIONS[task.status];
  if (!allowedNext || !allowedNext.includes(newStatus)) {
    throw new HttpError(409, `Không thể chuyển công việc từ trạng thái hiện tại sang "${newStatus}"`);
  }
  if (newStatus === 'DONE' && task.pendingExtension) {
    throw new HttpError(409, 'Công việc đang có 1 yêu cầu gia hạn chờ duyệt. Vui lòng Đồng ý hoặc Từ chối yêu cầu đó trước khi đóng công việc.');
  }
  if (newStatus === 'DONE' && task.pendingCancellation) {
    throw new HttpError(409, 'Công việc đang có 1 yêu cầu huỷ chờ duyệt. Vui lòng Đồng ý hoặc Từ chối yêu cầu đó trước khi đóng công việc.');
  }
  // Trước đây chỉ chặn DONE khi có yêu cầu gia hạn/huỷ đang chờ — không kiểm tra công việc nhỏ (subtask)
  // còn dở dang, nên có thể đánh dấu "Hoàn thành" dù còn subtask chưa xong, không có dấu hiệu cảnh báo.
  if (newStatus === 'DONE' && (task.subtasks || []).some(s => !s.done)) {
    throw new HttpError(409, 'Công việc còn công việc nhỏ (subtask) chưa hoàn thành. Vui lòng hoàn thành hết trước khi đóng công việc.');
  }
  // Chuyển TODO -> DOING qua đường này (người giao việc/admin bấm hộ) trước đây không ghi startedAt
  // như acceptTask() (đường "Nhận Việc" chính thức) vẫn làm — modal Chi tiết vẫn hiển thị "Chưa nhận
  // việc" dù việc đã "Đang thực hiện", dữ liệu tiến độ không nhất quán.
  if (task.status === 'TODO' && newStatus === 'DOING' && !task.startedAt) {
    task.startedAt = nowVN();
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
  if (task.status === 'DONE' || task.status === 'CANCELLED') {
    throw new HttpError(409, 'Công việc đã Hoàn thành/Đã huỷ — không thể xin gia hạn');
  }
  if (task.pendingCancellation) {
    throw new HttpError(409, 'Công việc đang có 1 yêu cầu huỷ chờ duyệt — không thể xin gia hạn lúc này');
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
  if (task.status === 'DONE' || task.status === 'CANCELLED') {
    throw new HttpError(409, 'Công việc đã Hoàn thành/Đã huỷ — không thể huỷ lại');
  }

  task.history = Array.isArray(task.history) ? task.history : [];
  if (isAssignerOrAdmin) {
    // Huỷ có hiệu lực NGAY — dọn sạch mọi yêu cầu gia hạn/huỷ đang chờ (nếu có) vì công việc đã đóng,
    // không còn gì để duyệt/từ chối nữa. Trước đây không xoá, khiến nút "Duyệt gia hạn"/"Duyệt huỷ" vẫn
    // hiện cho người giao việc trên 1 công việc đã CANCELLED — duyệt được thì đổi deadline/tăng
    // extensionCount trên công việc đã kết thúc, phá vỡ giả định "CANCELLED là trạng thái kết thúc".
    task.pendingExtension = null;
    task.pendingCancellation = null;
    task.status = 'CANCELLED';
    task.history.push({ action: 'CANCELLED', by: user.username, byName: user.name, time: nowVN(), note: reason });
  } else {
    if (task.pendingExtension) {
      throw new HttpError(409, 'Công việc đang có 1 yêu cầu gia hạn chờ duyệt — không thể xin huỷ lúc này');
    }
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
      // Đồng ý huỷ = công việc đóng lại — dọn nốt yêu cầu gia hạn đang chờ (nếu có, xem giải thích ở
      // cancelOrRequestCancelTask()) để không còn "Duyệt gia hạn" nào treo trên công việc đã CANCELLED.
      task.pendingExtension = null;
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
  // Công việc có thể đã bị huỷ trực tiếp (isAssignerOrAdmin, xem cancelOrRequestCancelTask()) SAU khi
  // yêu cầu này được gửi nhưng TRƯỚC khi được duyệt/từ chối — trước đây không kiểm tra, cho phép duyệt
  // gia hạn (đổi deadline/tăng extensionCount) trên 1 công việc đã CANCELLED. Nhánh này thực ra hiếm khi
  // chạy tới vì cancelOrRequestCancelTask() giờ đã tự dọn pendingExtension/pendingCancellation khi huỷ
  // trực tiếp — vẫn giữ lại như lớp phòng vệ thứ 2 phòng trường hợp task.status bị đổi qua đường khác.
  if (task.status === 'DONE' || task.status === 'CANCELLED') {
    throw new HttpError(409, 'Công việc đã Hoàn thành/Đã huỷ — không còn yêu cầu nào để xử lý');
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
// period: CALLER (routes/records.js) tự đọc trước rồi truyền vào, cùng khuôn với
// updateVppRegistrationDraft() bên dưới — trước đây hàm này KHÔNG kiểm tra kỳ còn mở hay không (khác
// updateVppRegistrationDraft đã có), nên NHÁP tạo lúc kỳ còn mở vẫn "Gửi" được sau khi kỳ đã đóng.
function submitVppRegistration(user, item, period) {
  if (item.creator !== user.username) throw new HttpError(403, 'Chỉ người tạo đăng ký mới được gửi hồ sơ này');
  if (item.status !== 'DRAFT') throw new HttpError(409, 'Đăng ký này không còn ở trạng thái nháp (có thể đã gửi hoặc đã bị xử lý)');
  if (!period) throw new HttpError(404, 'Không tìm thấy kỳ đăng ký');
  const todayStr = new Date().toISOString().slice(0, 10);
  const pastEndDate = !!(period.endDate && todayStr > period.endDate);
  if (period.status !== 'OPEN' || pastEndDate) {
    throw new HttpError(409, 'Kỳ đăng ký này đã kết thúc, không thể gửi đăng ký nữa');
  }
  if (!Array.isArray(item.items) || !item.items.length) {
    throw new HttpError(400, 'Chưa chọn mặt hàng nào — vui lòng chọn ít nhất 1 mặt hàng trước khi gửi');
  }
  // Ngân sách/người của kỳ (period.perPersonBudget, tuỳ chọn — null/0 = không giới hạn) là mức trần
  // cho TỪNG NGƯỜI, kiểm tra ở chính bước "Gửi phê duyệt" này (không chặn lúc lưu Nháp, để người
  // đăng ký thoải mái nháp thử trước khi chỉnh lại cho vừa ngân sách — client đã có cảnh báo realtime
  // + chặn trước ở đây, xem submitVppRegDraftAction()/updateVppRegTotalDisplay() ở index.html, nhưng
  // vẫn PHẢI kiểm tra lại ở server, không tin riêng client).
  if (period.perPersonBudget > 0) {
    const total = calcVppItemsTotal(item.items);
    if (total > period.perPersonBudget) {
      throw new HttpError(400, `Tổng tiền đăng ký (${total.toLocaleString('vi-VN')} đ) vượt quá ngân sách được cấp cho 1 người (${period.perPersonBudget.toLocaleString('vi-VN')} đ) — vui lòng giảm bớt số lượng trước khi gửi.`);
    }
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
  const GROUP_ORDER = { 'Quá hạn': 0, 'Đang thực hiện': 1, 'Chưa bắt đầu': 2, 'Đã hoàn thành': 3 };
  // Khớp đúng 3 mốc TASK_STATUS đang dùng ở statsText bên dưới (Đã hoàn thành/Đang thực hiện/Chưa bắt
  // đầu) — trước đây nhóm mọi việc chưa Quá hạn và chưa DONE chung 1 nhãn "Đang thực hiện", khiến việc
  // còn TODO (chưa ai Nhận Việc, chưa thực sự bắt đầu) hiện lẫn vào đúng nhóm với việc đang DOING trong
  // bảng danh sách chi tiết — lệch với số liệu counts.TODO/counts.DOING ở khối thống kê ngay phía trên.
  const groupOf = (t) => isOverdue(t) ? 'Quá hạn' : (t.status === 'DONE' ? 'Đã hoàn thành' : (t.status === 'DOING' ? 'Đang thực hiện' : 'Chưa bắt đầu'));

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
          _group: groupOf(t),
          group: groupOf(t),
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

// ===== ĐÀO TẠO (module con "Truyền Thông Nội Bộ" > Đào tạo) =====
// Đợt 3: tách cờ internalTrainingCreate cũ (đăng bài/tạo lớp/tài liệu/lộ trình) thành 2 quyền:
// - trainingManage: TOÀN QUYỀN — tạo mới lớp/tài liệu/bài test/lộ trình, quản lý roster/kết quả của
//   BẤT KỲ lớp nào (không còn giới hạn theo người TẠO lớp như cờ cũ), quản lý lộ trình thăng tiến.
// - trainingInstruct: KHÔNG tạo lớp mới được, nhưng quản lý được roster/kết quả của ĐÚNG (các) lớp mà
//   họ được gán làm giảng viên (cls.instructorUsername === username, xem canManageTrainingClass() ngay
//   dưới) — không đụng được lớp của giảng viên khác, không quản lý lộ trình/ngân hàng câu hỏi.
function canManageTraining(user) {
  return !!(user.perms?.admin || user.perms?.trainingManage);
}

// Quyền quản lý MỘT lớp học cụ thể (roster/kết quả/sửa nội dung/chuyển trạng thái buổi học) — dùng
// chung cho mọi hành động theo-từng-lớp bên dưới VÀ ở routes/trainingRoster.js (mã QR). Thay thế hẳn
// kiểu kiểm tra "cls.creator === user.username" cũ (Đợt 3 trở về trước): trainingManage giờ quản lý
// được MỌI lớp bất kể ai tạo, còn trainingInstruct chỉ quản lý đúng lớp mình được gán làm giảng viên —
// lớp cũ CHƯA có instructorUsername (dữ liệu nhập tay từ trước tính năng này, xem
// createValidation.js) thì KHÔNG ai thuộc diện trainingInstruct quản lý được, chỉ trainingManage/admin
// (giảm nhẹ có chủ đích, tránh đoán nhầm giảng viên cho dữ liệu cũ).
function canManageTrainingClass(user, cls) {
  if (user?.perms?.admin || user?.perms?.trainingManage) return true;
  return !!(user?.perms?.trainingInstruct && cls?.instructorUsername && cls.instructorUsername === user.username);
}

// Đợt 9 — học viên tự gửi KHÔNG còn huỷ có hiệu lực ngay nữa: chỉ tạo 1 yêu cầu đang chờ
// (pendingCancellation), phải được trainingManage/admin duyệt mới thật sự chuyển sang CANCELLED (xem
// approveCancelTrainingRegistration() ngay dưới) — tránh học viên tự ý bỏ lớp giữa chừng phá vỡ sĩ
// số/kế hoạch đã chốt mà không ai hay biết. Admin tự huỷ (hộ ai đó hoặc của chính mình) vẫn có hiệu lực
// NGAY như cũ vì admin đã LÀ cấp thẩm quyền cao nhất, không cần qua thêm 1 lớp duyệt của trainingManage.
function cancelTrainingRegistration(payload, user, reg) {
  if (reg.creator !== user.username && !user.perms?.admin) {
    throw new HttpError(403, 'Bạn chỉ có thể huỷ đăng ký của chính mình');
  }
  if (reg.result !== 'REGISTERED') {
    throw new HttpError(409, 'Đăng ký này không còn ở trạng thái có thể huỷ');
  }
  if (user.perms?.admin) {
    reg.result = 'CANCELLED';
    reg.resultBy = user.username;
    reg.resultByName = user.name;
    reg.resultAt = nowVN();
    reg.pendingCancellation = null;
    return reg;
  }
  if (reg.pendingCancellation) {
    throw new HttpError(409, 'Bạn đã gửi yêu cầu huỷ đăng ký này từ trước, đang chờ duyệt');
  }
  reg.pendingCancellation = {
    reason: payload?.reason ? String(payload.reason).trim() : '',
    requestedBy: user.username, requestedByName: user.name, requestedAt: nowVN()
  };
  return reg;
}

// Duyệt/từ chối yêu cầu huỷ ở trên — CỐ Ý chỉ trainingManage/admin (KHÔNG mở cho trainingInstruct dù
// giảng viên đó quản lý được lớp, vì đây là quyết định ảnh hưởng tới kế hoạch đào tạo chung của Nhân Sự,
// không phải nghiệp vụ giảng dạy đơn thuần của giảng viên).
function approveCancelTrainingRegistration(payload, user, reg) {
  if (!user.perms?.admin && !user.perms?.trainingManage) {
    throw new HttpError(403, 'Bạn không có quyền duyệt yêu cầu huỷ đăng ký lớp học');
  }
  if (!reg.pendingCancellation) throw new HttpError(404, 'Không tìm thấy yêu cầu huỷ đang chờ duyệt');
  reg.result = 'CANCELLED';
  reg.resultBy = user.username;
  reg.resultByName = user.name;
  reg.resultAt = nowVN();
  reg.pendingCancellation = null;
  return reg;
}
function rejectCancelTrainingRegistration(payload, user, reg) {
  if (!user.perms?.admin && !user.perms?.trainingManage) {
    throw new HttpError(403, 'Bạn không có quyền từ chối yêu cầu huỷ đăng ký lớp học');
  }
  if (!reg.pendingCancellation) throw new HttpError(404, 'Không tìm thấy yêu cầu huỷ đang chờ duyệt');
  reg.pendingCancellation = null;
  return reg;
}

// Đợt 9 — bắt buộc "học xong mới thi" cho lớp ONLINE: cls.documentIds (giáo trình bắt buộc, chọn lúc
// tạo/sửa lớp) học viên phải tự đánh dấu đã xem TỪNG tài liệu qua đây trước khi route submit-test cho
// làm bài (xem gác ở routes/records.js) — KHÔNG áp dụng lớp OFFLINE (giáo trình OFFLINE chỉ là tài liệu
// tham khảo, gác OFFLINE là sessionState phải ENDED, xem endOfflineTrainingClass()).
function markTrainingDocumentViewed(payload, user, reg, cls) {
  if (reg.creator !== user.username) {
    throw new HttpError(403, 'Bạn chỉ có thể đánh dấu đã xem cho đăng ký của chính mình');
  }
  if (reg.result === 'CANCELLED') throw new HttpError(409, 'Đăng ký này đã bị huỷ');
  const documentId = Number(payload?.documentId);
  if (!Number.isFinite(documentId)) throw new HttpError(400, 'Thiếu documentId');
  const requiredIds = Array.isArray(cls?.documentIds) ? cls.documentIds : [];
  if (!requiredIds.includes(documentId)) {
    throw new HttpError(400, 'Tài liệu này không thuộc giáo trình bắt buộc của lớp học');
  }
  reg.viewedDocumentIds = Array.isArray(reg.viewedDocumentIds) ? reg.viewedDocumentIds : [];
  if (!reg.viewedDocumentIds.includes(documentId)) reg.viewedDocumentIds.push(documentId);
  return reg;
}

// Ghi nhận kết quả (Đạt/Không đạt + điểm nếu có) cho 1 đăng ký — Đợt 3: gác bằng canManageTrainingClass()
// (cls đọc kèm theo reg.classId, xem routes/records.js) thay vì so trực tiếp reg.classCreator, để
// trainingManage quản lý được MỌI lớp và giảng viên gán riêng (trainingInstruct) quản lý được đúng lớp
// của mình dù không phải người đã tạo lớp đó.
function setTrainingRegistrationResult(payload, user, reg, cls) {
  if (!canManageTrainingClass(user, cls)) {
    throw new HttpError(403, 'Bạn không có quyền ghi nhận kết quả cho lớp học này');
  }
  if (reg.result === 'CANCELLED') {
    throw new HttpError(409, 'Đăng ký này đã bị huỷ, không thể ghi nhận kết quả');
  }
  // Đợt 8 — lớp ĐÃ gán bài test bắt buộc kết quả phải đến từ tự làm bài + tự động chấm
  // (applyAutoGradedTestResult(), qua route submit-test) — chặn hẳn đường tắt chấm tay ở đây để "Đạt"
  // của Lộ Trình Thăng Tiến/Lộ Trình Tân Binh (đều đếm theo lớp có testId, xem
  // confirmCareerPathForEmployee()/confirmOnboardingStage()) luôn thật sự qua thi, không bị chấm khống.
  // Lớp KHÔNG gán bài test thì vẫn chấm tay như cũ (không thuộc diện "bắt buộc thi").
  if (cls.testId != null) {
    throw new HttpError(409, 'Lớp học này đã gán bài test — kết quả chỉ được ghi nhận tự động khi học viên tự làm bài test, không thể chấm tay. Gỡ bài test khỏi lớp nếu thực sự cần chấm tay.');
  }
  const result = payload?.result;
  if (result !== 'PASSED' && result !== 'FAILED') {
    throw new HttpError(400, 'Kết quả không hợp lệ (chỉ nhận Đạt/Không đạt)');
  }
  const score = payload?.score;
  reg.score = (score === '' || score == null) ? null : Number(score);
  reg.result = result;
  reg.resultNote = (payload?.resultNote || '').trim();
  reg.resultBy = user.username;
  reg.resultByName = user.name;
  reg.resultAt = nowVN();
  return reg;
}

// trainingManage (bất kỳ lớp nào) hoặc giảng viên được gán riêng cho ĐÚNG lớp này (trainingInstruct) hoặc
// Admin thêm HÀNG LOẠT học viên vào 1 lớp học cùng lúc (chọn từng người ở dropdown, hoặc theo danh sách
// đọc từ file Excel — cả 2 cách đều gửi lên đúng 1 mảng usernames, khác biệt cách nhập chỉ ở phía
// client). CỐ Ý không bị inviteList chặn (xem createValidation.js trainingRegistrations) — đây là 1
// quyền ghi đè trực tiếp của HR/giảng viên, khác hẳn luồng tự đăng ký. Trả về bản NHÁP các đăng ký hợp
// lệ (route routes/records.js tự gán id + insertRecord từng dòng trong lúc đang giữ khoá theo classId)
// + danh sách bị bỏ qua kèm lý do, để người quản lý lớp biết chính xác ai chưa được thêm mà không phải
// đoán.
function bulkRegisterTrainingClass(payload, user, cls, existingRegs, users) {
  if (!canManageTrainingClass(user, cls)) {
    throw new HttpError(403, 'Bạn không có quyền thêm học viên vào lớp học này');
  }
  if (cls.status !== 'OPEN') throw new HttpError(409, 'Lớp học này đã đóng đăng ký');

  const requested = Array.isArray(payload?.usernames) ? payload.usernames : [];
  const seen = new Set(); // chặn trùng NGAY TRONG 1 lượt gửi (client gửi trùng username 2 lần)
  const added = [];
  const skipped = [];
  let activeCount = (existingRegs || []).filter(r => r.classId === cls.id && r.result !== 'CANCELLED').length;

  for (const raw of requested) {
    const username = String(raw || '').trim();
    if (!username || seen.has(username)) continue;
    seen.add(username);

    const targetUser = (users || []).find(u => u.username === username);
    if (!targetUser || targetUser.active === false) {
      skipped.push({ username, reason: 'NOT_FOUND' });
      continue;
    }
    const alreadyRegistered = (existingRegs || []).some(r => r.classId === cls.id && r.creator === username && r.result !== 'CANCELLED');
    if (alreadyRegistered) {
      skipped.push({ username, name: targetUser.name, reason: 'ALREADY_REGISTERED' });
      continue;
    }
    if (cls.capacity > 0 && activeCount >= cls.capacity) {
      skipped.push({ username, name: targetUser.name, reason: 'CAPACITY_FULL' });
      continue;
    }
    activeCount++;
    added.push({
      classId: cls.id, className: cls.title, classCode: cls.code, category: cls.category, classCreator: cls.creator,
      result: 'REGISTERED', score: null, resultNote: '', resultBy: null, resultByName: null, resultAt: null,
      creator: targetUser.username, creatorName: targetUser.name, dept: targetUser.dept
    });
  }
  return { added, skipped };
}

// Sửa nội dung/lịch 1 lớp học đã tạo (Đợt 3 — trước đây trainingClasses hoàn toàn không có tính năng
// sửa, chỉ tạo/xoá) — gác bằng canManageTrainingClass() giống roster/kết quả ở trên: trainingManage sửa
// được MỌI lớp, trainingInstruct chỉ sửa được đúng lớp mình được gán làm giảng viên. Whitelist field
// (cùng khuôn editInternalPost() ở trên) — KHÔNG cho đổi "mode" (ONLINE/OFFLINE) qua sửa vì mode quyết
// định luôn cách tính sessionState (sống vs chuyển tay, xem createValidation.js) và "status"/"sessionState"
// (2 field này chỉ đổi qua đúng action riêng của chúng, không phải qua /edit chung).
const TRAINING_CLASS_EDITABLE_FIELDS = [
  'title', 'category', 'description', 'startTime', 'endTime', 'location',
  'registerDeadline', 'capacity', 'passScore', 'testId', 'testSecondsPerQuestion', 'documentIds', 'courseId'
];
function editTrainingClass(payload, user, cls, tests, users, courses) {
  if (!canManageTrainingClass(user, cls)) {
    throw new HttpError(403, 'Bạn không có quyền sửa lớp học này');
  }
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Thiếu dữ liệu cập nhật');

  for (const field of TRAINING_CLASS_EDITABLE_FIELDS) {
    if (payload[field] !== undefined) cls[field] = payload[field];
  }
  if (!cls.category || !String(cls.category).trim()) throw new HttpError(400, 'Thiếu loại đào tạo');
  if (!cls.title || !String(cls.title).trim()) throw new HttpError(400, 'Thiếu tên lớp học');
  if (!cls.startTime) throw new HttpError(400, 'Thiếu thời gian bắt đầu lớp học');
  if (cls.endTime && cls.startTime && cls.endTime < cls.startTime) {
    throw new HttpError(400, 'Thời gian kết thúc phải sau thời gian bắt đầu');
  }
  cls.category = String(cls.category).trim();
  cls.title = String(cls.title).trim();
  cls.capacity = Number(cls.capacity) > 0 ? Math.floor(Number(cls.capacity)) : 0;
  cls.documentIds = Array.isArray(cls.documentIds) ? cls.documentIds.map(Number).filter(Number.isFinite) : [];
  const testId = cls.testId === '' || cls.testId == null ? null : Number(cls.testId);
  if (testId != null && (!Number.isFinite(testId) || !(tests || []).some(t => t.id === testId))) {
    throw new HttpError(400, 'Bài test được chọn không hợp lệ');
  }
  cls.testId = testId;
  // Điểm Đạt (%) — cùng luật bắt buộc với lúc TẠO lớp (xem createValidation.js trainingClasses.
  // extraValidate): lớp có gán bài test thì bắt buộc Điểm Đạt hợp lệ (1-100), không có test thì null.
  if (cls.testId != null) {
    const passScore = Number(cls.passScore);
    if (!Number.isFinite(passScore) || passScore <= 0 || passScore > 100) {
      throw new HttpError(400, 'Lớp có gán Bài Test cần nhập Điểm Đạt Yêu Cầu hợp lệ (1-100)');
    }
    cls.passScore = passScore;
  } else {
    cls.passScore = null;
  }
  const secPerQ = Number(cls.testSecondsPerQuestion);
  cls.testSecondsPerQuestion = Number.isFinite(secPerQ) && secPerQ >= 10 ? Math.floor(secPerQ) : 120;
  // Chương Trình (courseId, Đợt 4, tuỳ chọn) — cùng luật validate với lúc TẠO lớp (xem
  // createValidation.js trainingClasses.extraValidate).
  const courseId = cls.courseId === '' || cls.courseId == null ? null : Number(cls.courseId);
  if (courseId != null && (!Number.isFinite(courseId) || !(courses || []).some(c => c.id === courseId))) {
    throw new HttpError(400, 'Chương trình được chọn không hợp lệ');
  }
  cls.courseId = courseId;

  // Giảng viên + Danh Sách Được Mời — cùng luật resolve/chuẩn hoá với lúc TẠO lớp (xem
  // createValidation.js), chỉ áp dụng khi client thật sự gửi field tương ứng (không ép về rỗng nếu
  // form sửa không hiện field đó, vd modal sửa gọn không có ô Danh Sách Được Mời).
  if (payload.instructorUsername !== undefined || payload.instructor !== undefined) {
    const instructorUser = resolveTrainingInstructorUsername(payload.instructorUsername, users);
    cls.instructorUsername = instructorUser ? instructorUser.username : null;
    cls.instructor = instructorUser ? instructorUser.name : (payload.instructor ? String(payload.instructor).trim() : '');
  }
  if (payload.inviteList !== undefined) {
    cls.inviteList = normalizeInviteList(payload.inviteList);
  }
  return cls;
}

// Sửa 1 dòng Kế Hoạch Đào Tạo đã lập (trainingPlans, Đợt 5) — cùng khuôn editTrainingClass() ở trên
// (whitelist field rồi chạy lại ĐÚNG 1 luật chuẩn hoá/kiểm tra dùng chung với lúc TẠO, xem
// normalizeTrainingPlanFields() ở lib/createValidation.js) nhưng gác quyền đơn giản hơn — không có khái
// niệm "giảng viên phụ trách đúng lớp mình" ở đây, trainingManage quản lý được MỌI kế hoạch (đúng tinh
// thần "kế hoạch đào tạo là cấu hình toàn công ty" đã nêu ở createValidation.js).
const TRAINING_PLAN_EDITABLE_FIELDS = ['month', 'courseId', 'targetDept', 'audience', 'plannedClasses', 'plannedTrainees', 'plannedHours'];
function editTrainingPlan(payload, user, plan, appData) {
  if (!canManageTraining(user)) throw new HttpError(403, 'Bạn không có quyền sửa kế hoạch đào tạo');
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Thiếu dữ liệu cập nhật');
  for (const field of TRAINING_PLAN_EDITABLE_FIELDS) {
    if (payload[field] !== undefined) plan[field] = payload[field];
  }
  normalizeTrainingPlanFields(plan, appData);
  return plan;
}

// Vòng đời trạng thái buổi học của lớp OFFLINE (Đợt 3) — ONLINE không có 2 action này (tính sống theo
// giờ, xem createValidation.js/index.html), route /trainingClasses/:id/start-session chặn thẳng nếu
// mode khác OFFLINE trước khi gọi tới đây, nhưng vẫn kiểm tra lại ở đây cho chắc (đúng nguyên tắc
// "không tin, kiểm tra lại" của mọi mutator ghi đè state trong file này).
function startOfflineTrainingClass(user, cls) {
  if (!canManageTrainingClass(user, cls)) throw new HttpError(403, 'Bạn không có quyền bắt đầu lớp học này');
  if (cls.mode !== 'OFFLINE') throw new HttpError(409, 'Chỉ lớp học Offline mới cần bắt đầu buổi học thủ công');
  if (cls.sessionState !== 'SCHEDULED') throw new HttpError(409, 'Lớp học này không ở trạng thái chờ bắt đầu');
  cls.sessionState = 'ONGOING';
  return cls;
}
function endOfflineTrainingClass(user, cls) {
  if (!canManageTrainingClass(user, cls)) throw new HttpError(403, 'Bạn không có quyền kết thúc lớp học này');
  if (cls.mode !== 'OFFLINE') throw new HttpError(409, 'Chỉ lớp học Offline mới cần kết thúc buổi học thủ công');
  if (cls.sessionState !== 'ONGOING') throw new HttpError(409, 'Lớp học này chưa ở trạng thái đang diễn ra');
  cls.sessionState = 'ENDED';
  return cls;
}

// Chấm điểm bài test tự động — chốt lại HOÀN TOÀN ở server theo đúng đáp án đúng đã lưu của test
// (test.questions[].correctOptionIds, xem lib/createValidation.js), KHÔNG tin điểm/kết quả đúng-sai
// client tự tính gửi kèm, chỉ nhận rawAnswers (câu nào chọn đáp án nào). Đúng 1 câu hỏi = tập hợp đáp án
// chọn khớp CHÍNH XÁC tập hợp đáp án đúng (không thừa, không thiếu) — áp dụng cho cả loại 1 đáp án lẫn
// nhiều đáp án, chấm dứt khoát đúng/sai từng câu, không chấm điểm từng phần.
function gradeTrainingTestSubmission(rawAnswers, test, classPassScore) {
  const answersByQ = new Map();
  (Array.isArray(rawAnswers) ? rawAnswers : []).forEach(a => {
    const qId = Number(a?.questionId);
    if (Number.isFinite(qId)) answersByQ.set(qId, Array.isArray(a?.selectedOptionIds) ? a.selectedOptionIds.map(Number) : []);
  });

  let score = 0;
  let totalPoints = 0;
  const answers = test.questions.map(q => {
    totalPoints += q.points;
    const selected = [...new Set(answersByQ.get(q.id) || [])];
    const correctSet = new Set(q.correctOptionIds);
    const isCorrect = selected.length === correctSet.size && selected.every(id => correctSet.has(id));
    if (isCorrect) score += q.points;
    return { questionId: q.id, selectedOptionIds: selected, isCorrect };
  });

  const percentage = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;
  // Ngưỡng đạt/không đạt lấy từ ĐIỂM ĐẠT của LỚP HỌC (cls.passScore, lập lúc tạo lớp) — KHÔNG còn đọc
  // từ bài test nữa (Ngân Hàng Câu Hỏi không có field passScore riêng, xem createValidation.js). Giữ
  // fallback 60 cho dữ liệu lớp cũ trước khi có ràng buộc bắt buộc nhập Điểm Đạt khi gán test.
  const threshold = Number.isFinite(Number(classPassScore)) && Number(classPassScore) > 0 ? Number(classPassScore) : 60;
  const passed = percentage >= threshold;
  return { answers, score, totalPoints, percentage, passed };
}

// Ghi kết quả chấm tự động vào bản ghi Đăng Ký tương ứng — cùng khuôn setTrainingRegistrationResult()
// (resultBy/resultByName/resultAt) nhưng resultBy=null + resultByName cố định để phân biệt rõ đây là
// chấm tự động, không phải người tạo lớp tự tay ghi nhận. Chỉ ghi khi đăng ký còn ở trạng thái
// REGISTERED — chặn ghi đè 1 kết quả đã có sẵn (vd đã được người tạo lớp ghi tay trước đó, hoặc đã nộp
// bài test này rồi — dù route gọi hàm này đã tự kiểm tra 1 lượt nộp/lớp ở lớp khoá riêng, kiểm tra lại
// lần nữa ngay tại đây cho chắc, đúng nguyên tắc "không tin, kiểm tra lại" của mọi mutator ghi đè state).
function applyAutoGradedTestResult(reg, graded) {
  if (reg.result !== 'REGISTERED') {
    throw new HttpError(409, 'Đăng ký này đã có kết quả từ trước, không thể ghi đè bằng kết quả bài test');
  }
  reg.result = graded.passed ? 'PASSED' : 'FAILED';
  reg.score = graded.percentage;
  reg.resultNote = `Tự động chấm từ bài test (${graded.score}/${graded.totalPoints} điểm)`;
  reg.resultBy = null;
  reg.resultByName = 'Hệ thống (tự động chấm bài test)';
  reg.resultAt = nowVN();
  return reg;
}

// Xác nhận 1 nhân viên đã hoàn thành 1 CẤP BẬC của lộ trình thăng tiến (Đợt 7 — path.stages, thứ tự
// mảng = thứ tự cấp bậc) — CHỈ cho xác nhận khi:
//   1) cấp bậc TRƯỚC ĐÓ (stageIndex - 1) đã được xác nhận cho ĐÚNG người này ở ĐÚNG lộ trình này (gác
//      TUẦN TỰ — cấp 0 không có điều kiện tiên quyết);
//   2) cấp bậc này CHƯA từng được xác nhận cho người này (uniqueness pathId+username+stageIndex, đã đổi
//      từ pathId+username hồi trước khi có khái niệm nhiều cấp);
//   3) nhân viên đã có kết quả PASSED ở 1 lớp bất kỳ thuộc TỪNG chương trình bắt buộc của cấp này
//      (stage.requiredCourseIds — đổi từ requiredClassIds phẳng trỏ thẳng 1 lớp cụ thể, xem
//      lib/createValidation.js).
// Trả về bản NHÁP bản ghi xác nhận (chưa lưu) — routes/records.js insert vào collection
// careerPathConfirmations riêng (cùng khuôn startContractPayment() ở trên: mutator vừa xác thực vừa
// "sinh" ra 1 bản ghi mới ở collection khác, không mutate path). KHÔNG đụng tới user.jobTitle ở đây hay
// bất kỳ đâu trong luồng này — đổi chức danh vẫn 100% thủ công qua Quản Lý Người Dùng theo đúng yêu cầu
// đã chốt.
function confirmCareerPathForEmployee(payload, user, path, allRegistrations, existingConfirmations, users, trainingClasses) {
  if (!canManageTraining(user)) throw new HttpError(403, 'Bạn không có quyền xác nhận lộ trình thăng tiến');
  const targetUsername = (payload?.username || '').trim();
  if (!targetUsername) throw new HttpError(400, 'Thiếu người cần xác nhận');
  const targetUser = (users || []).find(u => u.username === targetUsername);
  if (!targetUser) throw new HttpError(404, 'Không tìm thấy nhân viên này');

  const stages = Array.isArray(path.stages) ? path.stages : [];
  const stageIndex = Number(payload?.stageIndex);
  if (!Number.isInteger(stageIndex) || stageIndex < 0 || stageIndex >= stages.length) {
    throw new HttpError(400, 'Cấp bậc cần xác nhận không hợp lệ');
  }
  const stage = stages[stageIndex];

  const myConfirmations = (existingConfirmations || []).filter(c => c.pathId === path.id && c.username === targetUsername);
  if (myConfirmations.some(c => c.stageIndex === stageIndex)) {
    throw new HttpError(409, `Nhân viên này đã được xác nhận hoàn thành Cấp ${stageIndex + 1} của lộ trình này rồi`);
  }
  if (stageIndex > 0 && !myConfirmations.some(c => c.stageIndex === stageIndex - 1)) {
    throw new HttpError(409, `Nhân viên chưa được xác nhận hoàn thành Cấp ${stageIndex} trước đó`);
  }

  const classes = trainingClasses || [];
  const requiredCourseIds = Array.isArray(stage.requiredCourseIds) ? stage.requiredCourseIds : [];
  // Đợt 8 — chỉ tính "Đạt" khi lớp đó CÓ gán bài test (c.testId != null): kết hợp với chỗ chặn chấm tay
  // ở setTrainingRegistrationResult() (chỉ chặn khi lớp có test), 1 lớp KHÔNG có test vẫn có thể bị chấm
  // tay "Đạt" mà chưa từng thi — filter này đảm bảo lớp như vậy không tính vào điều kiện xác nhận cấp
  // bậc, bắt buộc phải thi thật mới đủ điều kiện.
  const missing = requiredCourseIds.filter(courseId => !(allRegistrations || []).some(r =>
    r.creator === targetUsername && r.result === 'PASSED' &&
    classes.some(c => c.id === r.classId && c.courseId === courseId && c.testId != null)));
  if (missing.length) {
    throw new HttpError(409, `Nhân viên chưa đạt yêu cầu ở ${missing.length} chương trình bắt buộc của Cấp ${stageIndex + 1} — chưa thể xác nhận`);
  }

  return {
    pathId: path.id, pathName: path.name, stageIndex, stageName: stage.name,
    username: targetUsername, name: targetUser.name, dept: targetUser.dept,
    confirmedBy: user.username, confirmedByName: user.name, confirmedAt: nowVN()
  };
}

// ===== ĐÀO TẠO TÂN BINH (Đợt 6, module con "Đào Tạo") =====
// onboardingPaths ("Lộ Trình") quản lý (tạo/sửa/xoá) CHỈ trainingManage — dùng lại đúng canManageTraining()
// ở trên. onboardingProgress ("Phân Công") có 3 nhóm hành động riêng biệt hoàn toàn khác gác quyền nhau:
// - confirmOnboardingStage(): Nhân Sự (trainingManage/admin) xác nhận Giai đoạn 1/2 sau khi nhân viên
//   tự đạt đủ chương trình bắt buộc qua lớp học (Đợt 8).
// - evaluateOnboardingStage3(): quản lý CÙNG PHÒNG BAN/SIÊU THỊ với người được phân công (onboardingEvaluate
//   + so trực tiếp dept, KHÔNG có bảng ánh xạ nào khác — mirror ĐÚNG idiom uniformStoreManage/item.dept ở
//   canViewUniformIssuance()/canViewUniformStockAdjustment(), lib/recordViewScope.js).
// - issueOnboardingCertificate(): trainingManage/admin, CHỈ khi cả 3 giai đoạn đã ĐẠT.

// Sửa 1 Lộ Trình đã tạo (onboardingPaths, Đợt 6) — cùng khuôn editTrainingPlan() ở trên (whitelist field
// rồi chạy lại ĐÚNG 1 luật chuẩn hoá dùng chung với lúc TẠO, xem normalizeOnboardingPathFields() ở
// lib/createValidation.js).
const ONBOARDING_PATH_EDITABLE_FIELDS = ['name', 'stage1RequiredCourseIds', 'stage2RequiredCourseIds', 'stage3Criteria'];
function editOnboardingPath(payload, user, path, appData) {
  if (!canManageTraining(user)) throw new HttpError(403, 'Bạn không có quyền sửa lộ trình đào tạo tân binh');
  if (!payload || typeof payload !== 'object') throw new HttpError(400, 'Thiếu dữ liệu cập nhật');
  for (const field of ONBOARDING_PATH_EDITABLE_FIELDS) {
    if (payload[field] !== undefined) path[field] = payload[field];
  }
  normalizeOnboardingPathFields(path, appData);
  return path;
}

// Xác nhận 1 nhân viên đã hoàn thành Giai đoạn 1 hoặc 2 của lộ trình tân binh (Đợt 8 — cùng khuôn
// confirmCareerPathForEmployee() ở trên: NHÂN SỰ (trainingManage/admin) bấm Xác Nhận, không phải nhân
// viên tự nộp bài nữa — nhân viên tự đăng ký + học lớp thuộc đúng chương trình yêu cầu qua module Lớp
// Học như bình thường, "Đạt" đến từ đó). Gác tuần tự: Giai đoạn 2 chỉ xác nhận được sau khi Giai đoạn 1
// đã CONFIRMED. Yêu cầu tất cả chương trình bắt buộc của giai đoạn đó đã PASSED ở 1 lớp CÓ gán bài test
// (c.testId != null — xem giải thích ở confirmCareerPathForEmployee()).
function confirmOnboardingStage(payload, user, progress, path, allRegistrations, trainingClasses) {
  if (!canManageTraining(user)) throw new HttpError(403, 'Bạn không có quyền xác nhận giai đoạn đào tạo tân binh');
  const stage = Number(payload?.stage);
  if (stage !== 1 && stage !== 2) throw new HttpError(400, 'Giai đoạn không hợp lệ (chỉ nhận 1 hoặc 2)');
  const resultField = `stage${stage}Result`;
  if (progress[resultField] === 'CONFIRMED') {
    throw new HttpError(409, `Giai đoạn ${stage} đã được xác nhận hoàn thành từ trước rồi`);
  }
  if (stage === 2 && progress.stage1Result !== 'CONFIRMED') {
    throw new HttpError(409, 'Cần xác nhận hoàn thành Giai đoạn 1 trước khi xác nhận Giai đoạn 2');
  }
  if (!path) throw new HttpError(404, 'Không tìm thấy lộ trình đào tạo tân binh của hồ sơ này (có thể đã bị xoá)');
  const requiredCourseIds = Array.isArray(path[`stage${stage}RequiredCourseIds`]) ? path[`stage${stage}RequiredCourseIds`] : [];
  const classes = trainingClasses || [];
  const missing = requiredCourseIds.filter(courseId => !(allRegistrations || []).some(r =>
    r.creator === progress.employeeUsername && r.result === 'PASSED' &&
    classes.some(c => c.id === r.classId && c.courseId === courseId && c.testId != null)));
  if (missing.length) {
    throw new HttpError(409, `Nhân viên chưa đạt yêu cầu ở ${missing.length} chương trình bắt buộc của Giai đoạn ${stage} — chưa thể xác nhận`);
  }
  progress[resultField] = 'CONFIRMED';
  progress[`stage${stage}ConfirmedBy`] = user.username;
  progress[`stage${stage}ConfirmedByName`] = user.name;
  progress[`stage${stage}ConfirmedAt`] = nowVN();
  return progress;
}

// Quyền đánh giá Giai đoạn 3 — mirror ĐÚNG idiom uniformStoreManage/item.dept (lib/recordViewScope.js
// canViewUniformIssuance()/canViewUniformStockAdjustment()): so trực tiếp dept của NGƯỜI ĐƯỢC PHÂN CÔNG
// (đọc SỐNG từ hồ sơ user hiện tại qua users[], KHÔNG snapshot — khác startDate ở trên chủ đích snapshot;
// ở đây dùng dept THẬT hiện tại để 1 nhân viên chuyển phòng ban/siêu thị giữa chừng thì quản lý MỚI của
// họ đánh giá được, không kẹt vào quản lý CŨ) với dept của người đánh giá — không có bảng ánh xạ nào khác.
function canEvaluateOnboardingStage3(user, traineeUser) {
  if (user?.perms?.admin) return true;
  return !!(user?.perms?.onboardingEvaluate && traineeUser && traineeUser.dept === user.dept);
}

function evaluateOnboardingStage3(payload, user, progress, users) {
  const traineeUser = (users || []).find(u => u.username === progress.employeeUsername);
  if (!canEvaluateOnboardingStage3(user, traineeUser)) {
    throw new HttpError(403, 'Bạn không có quyền đánh giá Giai đoạn 3 cho nhân viên này (khác phòng ban/siêu thị hoặc không có quyền)');
  }
  if (progress.stage1Result !== 'CONFIRMED' || progress.stage2Result !== 'CONFIRMED') {
    throw new HttpError(409, 'Nhân viên cần được xác nhận hoàn thành cả Giai đoạn 1 và Giai đoạn 2 trước khi đánh giá Giai đoạn 3');
  }
  if (progress.stage3Evaluation != null) {
    throw new HttpError(409, 'Giai đoạn 3 của nhân viên này đã được đánh giá rồi');
  }
  const evaluation = payload?.evaluation === 'PASSED' || payload?.evaluation === 'FAILED' ? payload.evaluation : null;
  if (!evaluation) throw new HttpError(400, 'Kết quả đánh giá không hợp lệ (chỉ nhận Đạt/Không đạt)');
  progress.stage3Evaluation = evaluation;
  progress.stage3EvaluatedBy = user.username;
  progress.stage3EvaluatedByName = user.name;
  progress.stage3EvaluatedAt = nowVN();
  progress.stage3Note = (payload?.note || '').trim().slice(0, 3000);
  return progress;
}

// Cấp Chứng Chỉ Hoàn Thành — trainingManage/admin, CHỈ khi cả 3 giai đoạn đã ĐẠT. Chỉ đánh dấu
// certificateIssued/issuedAt/issuedBy ở đây — PDF được dựng lại HOÀN TOÀN ở client từ chính dữ liệu
// progress này (tên nhân viên/tên lộ trình/ngày cấp — xem downloadOnboardingCertificatePdf() ở
// index.html, kỹ thuật html2canvas+jsPDF giống exportBudgetSummaryPdf()), KHÔNG lưu file PDF nào ở
// server — "tính toán lại thay vì lưu trữ" đúng tinh thần chung của hệ thống (giống mọi số liệu SỐNG
// khác trong module Đào Tạo).
function issueOnboardingCertificate(user, progress) {
  if (!canManageTraining(user)) throw new HttpError(403, 'Bạn không có quyền cấp chứng chỉ hoàn thành đào tạo tân binh');
  if (progress.stage1Result !== 'CONFIRMED' || progress.stage2Result !== 'CONFIRMED' || progress.stage3Evaluation !== 'PASSED') {
    throw new HttpError(409, 'Nhân viên chưa hoàn thành cả 3 giai đoạn — chưa thể cấp chứng chỉ hoàn thành');
  }
  if (progress.certificateIssued) throw new HttpError(409, 'Chứng chỉ hoàn thành đã được cấp trước đó rồi');
  progress.certificateIssued = true;
  progress.certificateIssuedAt = nowVN();
  progress.certificateIssuedBy = user.username;
  return progress;
}

// ===== TUYỂN DỤNG (thay thế mục "Khen Thưởng" cũ trong Truyền Thông Nội Bộ) =====
// Dùng chung 1 cờ quyền internalRecruitmentCreate cho cả việc đăng/đóng tin tuyển dụng lẫn xem/xử lý hồ
// sơ ứng viên — coi như "hộp thư chung" của cả đội tuyển dụng, KHÔNG giới hạn theo "ai đăng tin nấy xử
// lý" (khác setTrainingRegistrationResult chỉ cho đúng người tạo lớp) vì thực tế nhiều tin do nhiều
// người trong bộ phận nhân sự đăng nhưng ai trong đội cũng cần xử lý được ứng viên của nhau.
function canManageRecruitment(user) {
  return !!(user.perms?.admin || user.perms?.internalRecruitmentCreate);
}

// Đợt 2: cho đóng tin từ CẢ OPEN lẫn FILLED (trước đây chỉ từ OPEN) — HR cần đóng hẳn 1 tin sau khi đã
// xác nhận tuyển đủ (confirmRecruitmentJobFilled() bên dưới), không còn cách nào khác để chuyển FILLED
// -> CLOSED nếu vẫn chặn như cũ. Không cho đóng lại tin ĐÃ đóng (giữ nguyên hành vi cũ).
function closeRecruitmentJob(payload, user, job) {
  if (job.creator !== user.username && !user.perms?.admin) {
    throw new HttpError(403, 'Chỉ người đăng tin hoặc Quản Trị Viên mới được đóng tin tuyển dụng này');
  }
  if (job.status === 'CLOSED') throw new HttpError(409, 'Tin tuyển dụng này đã đóng từ trước');
  job.status = 'CLOSED';
  return job;
}

// "Đã Tuyển Đủ" (Đợt 2) — xác nhận THỦ CÔNG bởi bất kỳ ai trong đội tuyển dụng (canManageRecruitment,
// KHÔNG giới hạn theo người đăng tin — cùng tinh thần setRecruitmentReferralStatus() bên dưới), CỐ Ý
// không chặn/yêu cầu số referral HIRED phải đạt slots trước khi cho xác nhận: HR có thể đã tuyển được
// người qua kênh khác ngoài hệ thống giới thiệu nội bộ này (đăng tuyển ngoài, headhunter...) mà hệ
// thống không thấy được, nên không thể tự động hoá điều kiện này — số liệu HIRED/slots chỉ dùng để GỢI
// Ý ở client (xem renderRecruitmentJobs() ở public/index.html), không phải điều kiện chặn ở đây.
function confirmRecruitmentJobFilled(payload, user, job) {
  if (!canManageRecruitment(user)) throw new HttpError(403, 'Bạn không có quyền xác nhận tin tuyển dụng đã tuyển đủ');
  if (job.status !== 'OPEN') throw new HttpError(409, 'Chỉ có thể xác nhận đã tuyển đủ với tin đang tuyển (OPEN)');
  job.status = 'FILLED';
  job.filledBy = user.username;
  job.filledByName = user.name;
  job.filledAt = nowVN();
  return job;
}

const RECRUITMENT_REFERRAL_STATUSES = new Set(['NEW', 'CONTACTED', 'HIRED', 'REJECTED']);

function setRecruitmentReferralStatus(payload, user, referral) {
  if (!canManageRecruitment(user)) throw new HttpError(403, 'Bạn không có quyền cập nhật trạng thái ứng viên');
  const status = payload?.status;
  if (!RECRUITMENT_REFERRAL_STATUSES.has(status)) throw new HttpError(400, 'Trạng thái không hợp lệ');
  referral.status = status;
  referral.statusNote = (payload?.statusNote || '').trim();
  referral.statusBy = user.username;
  referral.statusByName = user.name;
  referral.statusAt = nowVN();
  return referral;
}

// ===================== HỖ TRỢ IT =====================
// Cờ quyền chung cho cả 2 sub-module: xử lý ticket helpdesk + xác nhận đã áp giá xong. Việc DUYỆT giá
// (Phê Duyệt Giá) không dùng cờ này — đi qua quy trình theo phòng ban ở lib/workflowEngine.js
// (itPriceDeptWorkflows), giống hệt docs/carRegs/officeReqs.
function canManageItSupport(user) {
  return !!(user?.perms?.admin || user?.perms?.itManage);
}

// "Phê Duyệt Giá" — sau khi duyệt xong (status=APPROVED qua workflowEngine), người Hỗ Trợ IT áp giá vào
// hệ thống bán hàng NGOÀI app này rồi xác nhận hoàn thành NGAY TẠI ĐÂY — không phải 1 bước duyệt thêm
// (không đi qua applyWorkflowAction), chỉ đánh dấu đã thực hiện xong.
function hasUnresolvedPriceInfoRequest(item) {
  return (item.infoRequests || []).some(r => !r.response);
}

// "Tôi đang xử lý" — 1 người trong đội Hỗ Trợ IT nhận việc áp giá cho ĐÚNG đề xuất này, khoá lại để
// CHỈ chính người đó (hoặc admin) mới xác nhận hoàn thành được sau này — tránh 2 người cùng đội tưởng
// nhầm người kia đã áp giá xong (hoặc ngược lại, cùng áp giá trùng lặp) khi có nhiều đề xuất đang chờ
// cùng lúc. Cùng khuôn claimItTicket() ở dưới, nhưng ticket không khoá chặt lại được (ai có itManage
// cũng cập nhật trạng thái được, không riêng người nhận) — ở đây bắt buộc khoá chặt vì hành động sau đó
// (Xác nhận áp giá) ghi nhận là ĐÃ THỰC SỰ áp giá thật vào hệ thống bán hàng ngoài app, không phải chỉ
// cập nhật trạng thái nội bộ.
function claimPriceApply(user, item) {
  if (!canManageItSupport(user)) throw new HttpError(403, 'Bạn không có quyền nhận xử lý áp giá');
  if (item.status !== 'APPROVED') throw new HttpError(409, 'Đề xuất này chưa được phê duyệt xong');
  if (item.applied) throw new HttpError(409, 'Đề xuất này đã được áp giá rồi');
  if (item.applyClaimedBy) {
    throw new HttpError(409, `Đề xuất này đã có người nhận xử lý (${item.applyClaimedByName || item.applyClaimedBy})`);
  }
  item.applyClaimedBy = user.username;
  item.applyClaimedByName = user.name;
  item.applyClaimedAt = nowVN();
  return item;
}

// Huỷ nhận xử lý — trả đề xuất về hàng đợi chung cho người khác trong đội nhận lại, dùng khi người đã
// nhận không xử lý tiếp được nữa (nghỉ phép, bận việc khác...). Chỉ chính người đã nhận hoặc admin gọi
// được — người khác trong đội không tự ý huỷ giúp người đã nhận.
function releasePriceApplyClaim(user, item) {
  if (!canManageItSupport(user)) throw new HttpError(403, 'Bạn không có quyền huỷ nhận xử lý áp giá');
  if (!item.applyClaimedBy) throw new HttpError(409, 'Đề xuất này chưa có ai nhận xử lý');
  if (item.applyClaimedBy !== user.username && !user.perms?.admin) {
    throw new HttpError(403, 'Chỉ người đã nhận xử lý (hoặc Quản Trị Viên) mới huỷ được');
  }
  item.applyClaimedBy = null;
  item.applyClaimedByName = null;
  item.applyClaimedAt = null;
  return item;
}

function applyPriceApproval(user, item) {
  if (!canManageItSupport(user)) throw new HttpError(403, 'Bạn không có quyền xác nhận áp giá');
  if (item.status !== 'APPROVED') throw new HttpError(409, 'Đề xuất này chưa được phê duyệt xong');
  if (item.applied) throw new HttpError(409, 'Đề xuất này đã được áp giá rồi');
  // Bắt buộc phải bấm "Tôi đang xử lý" trước — chặn cả trường hợp chưa ai nhận (tránh xác nhận "tắt")
  // lẫn trường hợp người KHÁC đã nhận (chỉ đúng người đó mới xác nhận hoàn thành được, theo đúng yêu
  // cầu nghiệp vụ: không cho người khác xác nhận hộ việc mình không trực tiếp xử lý). Quản Trị Viên
  // (admin) luôn được bỏ qua cả 2 điều kiện này — cùng quy ước "admin override mọi bước" đã áp dụng
  // xuyên suốt engine duyệt theo phòng ban (xem canApproveStep() ở lib/workflowEngine.js).
  if (!user.perms?.admin) {
    if (!item.applyClaimedBy) {
      throw new HttpError(409, 'Vui lòng bấm "Tôi đang xử lý" trước khi xác nhận đã hoàn thành');
    }
    if (item.applyClaimedBy !== user.username) {
      throw new HttpError(403, `Chỉ ${item.applyClaimedByName || item.applyClaimedBy} (người đã nhận xử lý) mới xác nhận được`);
    }
  }
  if (hasUnresolvedPriceInfoRequest(item)) {
    throw new HttpError(409, 'Đề xuất đang có yêu cầu bổ sung chưa được người đề xuất phản hồi (tải tệp bổ sung), chưa thể xác nhận áp giá');
  }
  item.applied = true;
  item.appliedBy = user.username;
  item.appliedByName = user.name;
  item.appliedAt = nowVN();
  return item;
}

// Yêu Cầu Bổ Sung — nhánh của đội Hỗ Trợ IT (SAU khi đã APPROVED, TRƯỚC khi áp giá xong). Dùng CHUNG
// 1 mảng item.infoRequests với nhánh REQUEST_INFO của người duyệt phòng ban trong lúc còn PENDING (xem
// lib/workflowEngine.js) — cùng 1 chỗ kiểm tra "còn yêu cầu bổ sung chưa xử lý" ở cả 2 nhánh.
function requestPriceInfoFromIt(user, item, payload) {
  if (!canManageItSupport(user)) throw new HttpError(403, 'Bạn không có quyền yêu cầu bổ sung ở đây');
  if (item.status !== 'APPROVED') throw new HttpError(409, 'Đề xuất này chưa được phê duyệt xong');
  if (item.applied) throw new HttpError(409, 'Đề xuất này đã được áp giá rồi, không thể yêu cầu bổ sung thêm');
  if (hasUnresolvedPriceInfoRequest(item)) throw new HttpError(409, 'Đã có 1 yêu cầu bổ sung đang chờ xử lý');
  const reason = (payload?.reason || '').trim();
  if (!reason) throw new HttpError(400, 'Vui lòng nhập nội dung cần bổ sung');
  item.infoRequests = item.infoRequests || [];
  item.infoRequests.push({
    id: Date.now(), step: null,
    requestedBy: user.username, requestedByName: user.name,
    reason, requestedAt: nowVN(), response: null, respondedAt: null,
    byRole: 'it' // phân biệt với 'approver' (yêu cầu bổ sung từ người duyệt phòng ban, xem workflowEngine.js)
  });
  return item;
}

// Người đề xuất phản hồi yêu cầu bổ sung (từ CẢ 2 nguồn 'approver'/'it') bằng cách tải lên 1 tệp bảng
// giá MỚI — tệp này được THÊM VÀO cuối item.files, KHÔNG thay thế/xoá các tệp trước đó (yêu cầu nghiệp
// vụ: giữ đủ mọi phiên bản làm bằng chứng tham chiếu). Người duyệt/IT xem lại sẽ thấy toàn bộ lịch sử
// tệp + bảng so sánh sai lệch giữa tệp mới nhất và tệp liền trước (dựng ở client từ item.files).
function submitPriceSupplementFile(user, item, payload) {
  if (item.creator !== user.username) throw new HttpError(403, 'Chỉ người đề xuất mới được tải lên tệp bổ sung');
  const openReq = (item.infoRequests || []).find(r => !r.response);
  if (!openReq) throw new HttpError(409, 'Đề xuất này hiện không có yêu cầu bổ sung nào đang chờ xử lý');
  const file = payload?.file;
  if (!file || !file.fileUrl) throw new HttpError(400, 'Vui lòng tải lên tệp bảng giá bổ sung (.xlsx)');
  const items = sanitizePriceFileItems(file.items);
  const newFile = {
    id: Date.now(),
    fileUrl: String(file.fileUrl).slice(0, 300),
    fileName: (String(file.fileName || '').trim() || 'bang-gia-bo-sung.xlsx').slice(0, 200),
    uploadedBy: user.username, uploadedByName: user.name,
    uploadedAt: nowVN(),
    items
  };
  item.files = item.files || [];
  item.files.push(newFile);
  openReq.response = `Đã tải lên tệp bổ sung: ${newFile.fileName}`;
  openReq.respondedAt = nowVN();
  item.history = item.history || [];
  item.history.push({
    step: item.currentStep, approver: user.name, username: user.username,
    action: 'SUBMIT_SUPPLEMENT', comment: openReq.response, time: openReq.respondedAt
  });
  return item;
}

// "Hỗ Trợ Yêu Cầu" — ticket helpdesk IT nội bộ, ai cũng tạo được (xem itSupportTickets ở
// lib/createValidation.js), chỉ người có itManage/admin mới xử lý được. State machine đơn giản:
// TODO -> DOING (khi có người nhận) -> DONE, hoặc CANCELLED bất kỳ lúc nào trước khi DONE.
const IT_TICKET_STATUSES = new Set(['TODO', 'DOING', 'DONE', 'CANCELLED']);

function claimItTicket(user, ticket) {
  if (!canManageItSupport(user)) throw new HttpError(403, 'Bạn không có quyền nhận xử lý yêu cầu hỗ trợ IT');
  if (ticket.status !== 'TODO') throw new HttpError(409, 'Yêu cầu này đã có người nhận xử lý hoặc đã đóng');
  ticket.assignee = user.username;
  ticket.assigneeName = user.name;
  ticket.status = 'DOING';
  return ticket;
}

function updateItTicketStatus(user, ticket, payload) {
  if (!canManageItSupport(user)) throw new HttpError(403, 'Bạn không có quyền cập nhật yêu cầu hỗ trợ IT');
  const status = payload?.status;
  if (!IT_TICKET_STATUSES.has(status)) throw new HttpError(400, 'Trạng thái không hợp lệ');
  if (ticket.status === 'DONE' || ticket.status === 'CANCELLED') {
    throw new HttpError(409, 'Yêu cầu này đã kết thúc, không thể cập nhật thêm');
  }
  // Đang chờ phê duyệt HOẶC vừa bị từ chối -> chưa cho đóng yêu cầu qua đây (đúng yêu cầu nghiệp vụ:
  // "sau khi nhận phê duyệt thì IT mới tiếp tục xử lý") — vẫn có thể huỷ hẳn yêu cầu qua cancelItTicket()
  // riêng (không đi qua route này), hoặc gửi lại yêu cầu phê duyệt qua escalateItTicket().
  if (ticket.approvalStatus === 'PENDING' || ticket.approvalStatus === 'REJECTED') {
    throw new HttpError(409, 'Đang chờ hoặc chưa được phê duyệt — gửi lại yêu cầu phê duyệt hoặc hủy yêu cầu này trước khi cập nhật tiến độ');
  }
  ticket.status = status;
  if (payload?.resolutionNote != null) ticket.resolutionNote = String(payload.resolutionNote).trim();
  return ticket;
}

// Cho phép chính người tạo bình luận thêm vào ticket của mình (vd bổ sung thông tin) chứ không chỉ
// riêng đội IT — giống cơ chế bình luận Góc chia sẻ, nhưng phạm vi hẹp: chỉ tác giả + đội IT + người
// được chỉ định phê duyệt (đúng ticket đó, xem escalateItTicket() bên dưới).
function addItTicketComment(user, ticket, payload) {
  const content = (payload?.content || '').trim();
  if (!content) throw new HttpError(400, 'Vui lòng nhập nội dung bình luận');
  if (!canManageItSupport(user) && ticket.creator !== user.username && ticket.approvalApprover !== user.username) {
    throw new HttpError(403, 'Bạn không có quyền bình luận ở yêu cầu này');
  }
  ticket.comments = ticket.comments || [];
  ticket.comments.push({ id: Date.now(), username: user.username, name: user.name, content, time: nowVN() });
  return ticket;
}

// Leo thang phê duyệt (tuỳ chọn) — đội Hỗ Trợ IT đang xử lý (DOING) 1 ticket có thể chủ động xin ý
// kiến/phê duyệt của 1 người có trách nhiệm CỤ THỂ (không nhất thiết thuộc đội IT, vd trưởng phòng liên
// quan) TRƯỚC KHI tiếp tục xử lý — người được hỏi chỉ xem/duyệt được ĐÚNG ticket đó (canViewItSupportTicket
// ở lib/recordViewScope.js), không mở cả danh sách. approvalStatus tách biệt hoàn toàn khỏi status
// (TODO/DOING/DONE/CANCELLED): PENDING/REJECTED chặn updateItTicketStatus() ở trên cho tới khi được duyệt.
function escalateItTicket(user, ticket, payload, usersList) {
  if (!canManageItSupport(user)) throw new HttpError(403, 'Bạn không có quyền gửi yêu cầu phê duyệt ở đây');
  if (ticket.status !== 'DOING') throw new HttpError(409, 'Chỉ gửi được yêu cầu phê duyệt khi yêu cầu đang được xử lý');
  if (ticket.approvalStatus === 'PENDING') throw new HttpError(409, 'Đã có 1 yêu cầu phê duyệt đang chờ xử lý');
  const reason = (payload?.reason || '').trim();
  if (!reason) throw new HttpError(400, 'Vui lòng nhập lý do cần phê duyệt');
  const approverUsername = payload?.approverUsername;
  const approver = (usersList || []).find(u => u.username === approverUsername && u.active !== false);
  if (!approver) throw new HttpError(400, 'Không tìm thấy người được chọn phê duyệt (hoặc tài khoản đã bị khoá)');
  if (approver.username === user.username) throw new HttpError(400, 'Không thể tự chọn chính mình làm người phê duyệt');
  ticket.approvalStatus = 'PENDING';
  ticket.approvalApprover = approver.username;
  ticket.approvalApproverName = approver.name;
  ticket.approvalReason = reason;
  ticket.approvalComment = '';
  ticket.comments = ticket.comments || [];
  ticket.comments.push({ id: Date.now(), username: user.username, name: user.name, content: `🔔 Đã gửi yêu cầu phê duyệt tới ${approver.name}: ${reason}`, time: nowVN() });
  return ticket;
}

function approveItTicketEscalation(user, ticket) {
  if (ticket.approvalApprover !== user.username) throw new HttpError(403, 'Bạn không phải người được yêu cầu phê duyệt ở đây');
  if (ticket.approvalStatus !== 'PENDING') throw new HttpError(409, 'Yêu cầu phê duyệt này không còn ở trạng thái chờ xử lý');
  ticket.approvalStatus = 'APPROVED';
  ticket.approvalComment = '';
  ticket.comments = ticket.comments || [];
  ticket.comments.push({ id: Date.now(), username: user.username, name: user.name, content: '✅ Đã duyệt yêu cầu phê duyệt', time: nowVN() });
  return ticket;
}

function denyItTicketEscalation(user, ticket, payload) {
  if (ticket.approvalApprover !== user.username) throw new HttpError(403, 'Bạn không phải người được yêu cầu phê duyệt ở đây');
  if (ticket.approvalStatus !== 'PENDING') throw new HttpError(409, 'Yêu cầu phê duyệt này không còn ở trạng thái chờ xử lý');
  const comment = (payload?.comment || '').trim();
  if (!comment) throw new HttpError(400, 'Vui lòng nhập lý do từ chối');
  ticket.approvalStatus = 'REJECTED';
  ticket.approvalComment = comment;
  ticket.comments = ticket.comments || [];
  ticket.comments.push({ id: Date.now(), username: user.username, name: user.name, content: `❌ Đã từ chối yêu cầu phê duyệt: ${comment}`, time: nowVN() });
  return ticket;
}

function cancelItTicket(user, ticket) {
  if (!canManageItSupport(user) && ticket.creator !== user.username) {
    throw new HttpError(403, 'Bạn không có quyền hủy yêu cầu này');
  }
  if (ticket.status === 'DONE' || ticket.status === 'CANCELLED') {
    throw new HttpError(409, 'Yêu cầu này đã kết thúc, không thể hủy');
  }
  ticket.status = 'CANCELLED';
  return ticket;
}

// ===================== ĐỒNG PHỤC (module con của Hành Chính) =====================
// Hành Chính (uniformManage) tạo "Kỳ Cấp Phát" (uniformPeriods, đi qua engine chung ở
// lib/createValidation.js) phân bổ đồng phục xuống 1 hoặc nhiều siêu thị. Mỗi siêu thị có 1 Giám Đốc
// (uniformStoreManage, phạm vi = ĐÚNG phòng ban của họ, user.dept = tên siêu thị) tự xác nhận đã nhận
// phần phân bổ của mình (confirmUniformAllocation) rồi cấp phát cho nhân viên (buildUniformIssuance) —
// hành động cấp phát của giám đốc CHÍNH LÀ xác nhận, không cần nhân viên thao tác gì thêm. "Kho đồng
// phục" KHÔNG lưu thành bảng tồn kho riêng (tránh 2 nguồn ghi lệch nhau) mà LUÔN tính lại từ 2 nguồn:
// tổng đã CONFIRMED trong uniformPeriods.allocations trừ tổng đã ghi trong uniformIssuances — dùng
// chung 1 hàm computeUniformStock() cho cả bước kiểm tra tồn kho lúc cấp phát lẫn màn hình xem kho.
function canManageUniform(user) {
  return !!(user?.perms?.admin || user?.perms?.uniformManage);
}
function canManageUniformStore(user) {
  return !!(user?.perms?.admin || user?.perms?.uniformStoreManage);
}

// allPeriods: toàn bộ uniformPeriods (đọc từ collection uniformPeriods). allIssuances/allAdjustments:
// toàn bộ uniformIssuances/uniformStockAdjustments CỦA ĐÚNG siêu thị (caller tự lọc theo dept trước khi
// gọi, tránh đọc thừa). allAdjustments có thể bỏ trống (backward-compat) — hong/huy/recalled mặc định 0.
// Trả về Map key `${name}|||${size}` -> { name, size, allocated, issued, recalled, hong, huy, stock }.
// "issued" giữ nguyên Ý NGHĨA CŨ (tổng đã cấp CỘNG DỒN mọi thời điểm, không trừ thu hồi — khớp số liệu
// báo cáo "tổng SL đã cấp" ở renderUniformReportExtra()). "recalled" = đã thu hồi lại từ nhân viên
// (uniformStockAdjustments.source === 'EMPLOYEE', bất kể kết quả sau thu hồi là gì) — dùng để TRỪ RA
// khỏi "issued" khi tính "stock" (hàng thu hồi coi như không còn nằm ở nhân viên nữa). "hong"/"huy" =
// đã báo hỏng/hủy/mất CỘNG DỒN cả 2 nguồn: trực tiếp từ tồn kho (source='STOCK') lẫn phát hiện lúc thu
// hồi từ nhân viên (source='EMPLOYEE', outcome='HONG'/'HUY'/'MAT') — các trường hợp này đều làm mất số
// lượng thật, không phân biệt trong công thức tồn kho. mat CHỈ phát sinh từ source='EMPLOYEE' (đồ đã
// cấp cho nhân viên bị thất lạc — không có khái niệm "mất" cho hàng còn nằm trong kho chưa cấp, xem
// validOutcomes ở buildUniformStockAdjustment() bên dưới). "transferOut"/"transferIn" (Phase 2) = tổng
// SL đã ĐIỀU CHUYỂN đi/nhận về qua uniformTransfers ĐÃ APPROVED (xem buildUniformTransfer()/
// approveUniformTransfer() bên dưới) — tham số cuối `allApprovedTransfers` TUỲ CHỌN (backward-compat,
// bỏ trống -> coi như 0, không ảnh hưởng caller nào chưa truyền). Công thức:
// stock = allocated - (issued - recalled) - hong - huy - mat - transferOut + transferIn.
function computeUniformStock(allPeriods, storeDept, allIssuances, allAdjustments, allApprovedTransfers) {
  const stock = new Map();
  const keyOf = (name, size) => `${name}|||${size || ''}`;
  const bump = (name, size, field, qty) => {
    const key = keyOf(name, size);
    if (!stock.has(key)) stock.set(key, { name, size: size || '', allocated: 0, issued: 0, recalled: 0, hong: 0, huy: 0, mat: 0, transferOut: 0, transferIn: 0 });
    stock.get(key)[field] += qty;
  };
  for (const period of allPeriods || []) {
    for (const alloc of period.allocations || []) {
      if (alloc.dept !== storeDept || alloc.status !== 'CONFIRMED') continue;
      for (const it of alloc.items || []) bump(it.name, it.size, 'allocated', it.qty);
    }
  }
  for (const issuance of allIssuances || []) {
    if (issuance.dept !== storeDept) continue;
    for (const it of issuance.items || []) bump(it.name, it.size, 'issued', it.qty);
  }
  for (const t of allApprovedTransfers || []) {
    if (t.status !== 'APPROVED') continue; // caller nên tự lọc trước, kiểm tra lại đây cho chắc
    if (t.sourceDept === storeDept) bump(t.itemName, t.size, 'transferOut', t.qty);
    if (t.targetDept === storeDept) bump(t.itemName, t.size, 'transferIn', t.qty);
  }
  for (const adj of allAdjustments || []) {
    if (adj.dept !== storeDept) continue;
    if (adj.source === 'EMPLOYEE') bump(adj.itemName, adj.size, 'recalled', adj.qty);
    if (adj.outcome === 'HONG') bump(adj.itemName, adj.size, 'hong', adj.qty);
    if (adj.outcome === 'HUY') bump(adj.itemName, adj.size, 'huy', adj.qty);
    if (adj.outcome === 'MAT') bump(adj.itemName, adj.size, 'mat', adj.qty);
  }
  for (const row of stock.values()) row.stock = row.allocated - (row.issued - row.recalled) - row.hong - row.huy - row.mat - row.transferOut + row.transferIn;
  return stock;
}

// Số lượng 1 nhân viên ĐANG THỰC SỰ GIỮ (đã cấp trừ đi phần đã thu hồi lại của riêng người đó) — dùng để
// chặn thu hồi vượt quá số đang giữ. allIssuancesOfStore/allAdjustmentsOfStore: đã lọc theo dept (giống
// tham số computeUniformStock() ở trên). Trả về Map `${name}|||${size}` -> qty đang giữ.
function computeEmployeeUniformHolding(employeeUsername, allIssuancesOfStore, allAdjustmentsOfStore) {
  const held = new Map();
  const keyOf = (name, size) => `${name}|||${size || ''}`;
  const bump = (name, size, delta) => {
    const key = keyOf(name, size);
    held.set(key, (held.get(key) || 0) + delta);
  };
  for (const issuance of allIssuancesOfStore || []) {
    if (issuance.employeeUsername !== employeeUsername) continue;
    for (const it of issuance.items || []) bump(it.name, it.size, it.qty);
  }
  for (const adj of allAdjustmentsOfStore || []) {
    if (adj.source !== 'EMPLOYEE' || adj.employeeUsername !== employeeUsername) continue;
    bump(adj.itemName, adj.size, -adj.qty);
  }
  return held;
}

// Số lượng ĐANG THỰC SỰ GIỮ của MỌI nhân viên tại 1 siêu thị, gộp theo (nhân viên, tên, size) — dùng
// để dựng bảng "Đồng Phục Nhân Viên Đang Giữ" phía client (nguồn cho 3 nút Thu Hồi/Báo Hỏng/Báo Mất
// theo từng dòng, xem public/index.html). Cùng công thức với computeEmployeeUniformHolding() ở trên,
// chỉ khác là quét TẤT CẢ nhân viên cùng lúc thay vì lọc theo 1 người.
function computeAllEmployeeUniformHoldings(allIssuancesOfStore, allAdjustmentsOfStore) {
  const held = new Map();
  const keyOf = (empUsername, name, size) => `${empUsername}|||${name}|||${size || ''}`;
  const bump = (empUsername, empName, name, size, delta) => {
    const key = keyOf(empUsername, name, size);
    if (!held.has(key)) held.set(key, { employeeUsername: empUsername, employeeName: empName, name, size: size || '', held: 0 });
    held.get(key).held += delta;
  };
  for (const issuance of allIssuancesOfStore || []) {
    for (const it of issuance.items || []) bump(issuance.employeeUsername, issuance.employeeName, it.name, it.size, it.qty);
  }
  for (const adj of allAdjustmentsOfStore || []) {
    if (adj.source !== 'EMPLOYEE') continue;
    bump(adj.employeeUsername, adj.employeeName, adj.itemName, adj.size, -adj.qty);
  }
  return Array.from(held.values()).filter(r => r.held > 0);
}

// ===== Duyệt kỳ cấp phát (Phase 2 — cổng duyệt Ở CẤP KỲ, TRƯỚC bước Giám Đốc Siêu Thị tự xác nhận) =====
// uniformApprove (quyền MỚI, admin cũng qua được) — người có quyền này duyệt/từ chối CẢ KỲ 1 lần
// (không phải luồng nhiều bước qua lib/workflowEngine.js, chỉ 1 cờ trạng thái phẳng giống hệt khuôn
// confirmUniformAllocation() ở trên). PENDING_APPROVAL (mặc định lúc tạo, xem lib/createValidation.js)
// -> APPROVED (Giám Đốc Siêu Thị mới bắt đầu xác nhận được, xem confirmUniformAllocation() bên dưới) |
// REJECTED (TERMINAL — không kỳ nào quay lại xác nhận được nữa, đúng khuôn "từ chối là điểm dừng cứng"
// đã dùng ở mọi nơi khác trong hệ thống — kiểm tra lại NGAY TRONG confirmUniformAllocation(), không chỉ
// chặn ở đây, vì API xác nhận có thể bị gọi thẳng bỏ qua bước duyệt trên giao diện).
// Kỳ tạo TRƯỚC Phase 2 (không có field approvalStatus) coi như đã được chấp nhận từ trước (bỏ qua cổng
// này) — tránh chặn ngược các phân bổ PENDING_CONFIRM đã tồn tại từ trước khi tính năng này ra đời.
function canApproveUniform(user) {
  return !!(user?.perms?.admin || user?.perms?.uniformApprove);
}

function approveUniformPeriod(user, period) {
  if (!canApproveUniform(user)) throw new HttpError(403, 'Bạn không có quyền duyệt kỳ cấp phát đồng phục');
  if (period.approvalStatus && period.approvalStatus !== 'PENDING_APPROVAL') {
    throw new HttpError(409, 'Kỳ cấp phát này đã được xử lý duyệt trước đó');
  }
  period.approvalStatus = 'APPROVED';
  period.approvedBy = user.username;
  period.approvedByName = user.name;
  period.approvedAt = nowVN();
  period.rejectReason = '';
  return period;
}

function rejectUniformPeriod(user, period, payload) {
  if (!canApproveUniform(user)) throw new HttpError(403, 'Bạn không có quyền duyệt kỳ cấp phát đồng phục');
  if (period.approvalStatus && period.approvalStatus !== 'PENDING_APPROVAL') {
    throw new HttpError(409, 'Kỳ cấp phát này đã được xử lý duyệt trước đó');
  }
  const reason = String(payload?.reason || '').trim().slice(0, 500);
  period.approvalStatus = 'REJECTED';
  period.approvedBy = user.username;
  period.approvedByName = user.name;
  period.approvedAt = nowVN();
  period.rejectReason = reason;
  return period;
}

// ===== SKU đồng phục (Phase 2) — sinh 1 LẦN DUY NHẤT cho mỗi (tên, size), TÁI SỬ DỤNG mãi mãi sau đó,
// bất kể siêu thị/kỳ nào xác nhận trước. Bỏ dấu tiếng Việt cùng tinh thần generateHcrcCode()
// (public/index.html) nhưng KHÔNG dùng ngày tạo làm tiền tố (SKU không gắn với 1 lần xác nhận cụ thể) —
// số thứ tự đếm theo TỔNG số SKU đã sinh trong toàn bộ danh mục tới thời điểm này (giống nguyên lý đếm
// bản ghi hiện có +1 của computeNextHcrcSeq(), không cần bảng đếm riêng). Định dạng:
// {VIẾT-TẮT-KHÔNG-DẤU}-{SIZE}-{số thứ tự 4 số}, vd "Áo sơ mi" + size L -> "AOSOMI-L-0007".
function stripVietnameseDiacritics(str) {
  return String(str || '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function abbreviateUniformItemName(name) {
  const clean = stripVietnameseDiacritics(name).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return (clean || 'SP').slice(0, 15);
}
function computeNextUniformSkuSeq(catalog) {
  let count = 0;
  for (const entry of catalog || []) count += Object.keys(entry.codesBySize || {}).length;
  return count + 1;
}
function generateUniformSkuCode(name, size, catalog) {
  const abbr = abbreviateUniformItemName(name);
  const seq = computeNextUniformSkuSeq(catalog);
  return `${abbr}-${String(size || '').trim().toUpperCase() || 'X'}-${String(seq).padStart(4, '0')}`;
}
// Đảm bảo MỌI (name, size) trong `items` đã có SKU trong `catalog` — sinh mới nếu còn thiếu, TÁI SỬ
// DỤNG nếu đã có (dù được sinh lúc xác nhận ở siêu thị khác/kỳ khác trước đó). Mutate THẲNG `catalog`
// (mảng đọc dưới khoá withLockedAppDataValue('uniformCatalog', ...) ở routes/records.js) — không tự đọc
// /ghi gì, caller chịu trách nhiệm khoá+lưu. Mặt hàng không còn trong danh mục (đã bị xoá sau khi phân
// bổ) thì bỏ qua, không chặn việc xác nhận chỉ vì thiếu SKU.
function backfillUniformSkuCodes(items, catalog) {
  let changed = false;
  for (const it of items || []) {
    const entry = (catalog || []).find(c => c.name === it.name);
    if (!entry) continue;
    if (!entry.codesBySize) entry.codesBySize = {};
    const size = it.size || '';
    if (entry.codesBySize[size]) continue;
    entry.codesBySize[size] = generateUniformSkuCode(it.name, size, catalog);
    changed = true;
  }
  return changed;
}

function confirmUniformAllocation(user, period, payload) {
  if (!canManageUniformStore(user)) throw new HttpError(403, 'Bạn không có quyền xác nhận nhận đồng phục');
  if (period.approvalStatus === 'REJECTED') {
    throw new HttpError(409, 'Kỳ cấp phát này đã bị từ chối duyệt, không thể xác nhận nhận hàng');
  }
  if (period.approvalStatus && period.approvalStatus !== 'APPROVED') {
    throw new HttpError(409, 'Kỳ cấp phát này chưa được duyệt, chưa thể xác nhận nhận hàng');
  }
  const allocId = Number(payload?.allocationId);
  const alloc = (period.allocations || []).find(a => a.id === allocId);
  if (!alloc) throw new HttpError(404, 'Không tìm thấy dòng phân bổ này trong kỳ');
  if (alloc.dept !== user.dept) throw new HttpError(403, 'Bạn chỉ xác nhận được phần phân bổ của siêu thị mình');
  if (alloc.status !== 'PENDING_CONFIRM') throw new HttpError(409, 'Phần phân bổ này đã được xác nhận trước đó');
  alloc.status = 'CONFIRMED';
  alloc.confirmedBy = user.username;
  alloc.confirmedByName = user.name;
  alloc.confirmedAt = nowVN();
  return period;
}

// Xây (KHÔNG ghi) 1 bản ghi uniformIssuances mới — caller (routes/records.js) đọc trước toàn bộ
// uniformPeriods + uniformIssuances CỦA ĐÚNG SIÊU THỊ NÀY, bọc quanh bằng withAppLock('uniform_store:'
// + user.dept, ...) để 2 lượt cấp phát gần như đồng thời cùng 1 siêu thị không cùng vượt tồn kho (đọc
// xong-tính-ghi phải nguyên tử theo TỪNG siêu thị, không cần khoá toàn app vì các siêu thị độc lập nhau).
function buildUniformIssuance(user, payload, allPeriods, allIssuancesOfStore, usersList, allApprovedTransfers) {
  if (!canManageUniformStore(user)) throw new HttpError(403, 'Bạn không có quyền cấp phát đồng phục');
  const employeeUsername = String(payload?.employeeUsername || '').trim();
  const employee = (usersList || []).find(u => u.username === employeeUsername && u.active !== false);
  if (!employee) throw new HttpError(400, 'Không tìm thấy nhân viên này (hoặc tài khoản đã bị khoá)');
  if (employee.dept !== user.dept) throw new HttpError(400, 'Chỉ cấp phát được cho nhân viên thuộc siêu thị của bạn');

  const items = sanitizeUniformItems(payload?.items);
  const stock = computeUniformStock(allPeriods, user.dept, allIssuancesOfStore, null, allApprovedTransfers);
  for (const it of items) {
    const row = stock.get(`${it.name}|||${it.size || ''}`);
    const available = row ? row.stock : 0;
    if (it.qty > available) {
      throw new HttpError(409, `Không đủ tồn kho "${it.name}"${it.size ? ` (size ${it.size})` : ''}: còn ${available}, cần cấp ${it.qty}`);
    }
  }

  return {
    id: Date.now(), code: String(payload?.code || '').trim(),
    dept: user.dept, deptName: user.dept,
    creator: user.username, creatorName: user.name,
    employeeUsername: employee.username, employeeName: employee.name,
    items,
    note: (payload?.note || '').trim().slice(0, 500),
    createdAt: nowVN()
  };
}

// Xây (KHÔNG ghi) 1 bản ghi uniformStockAdjustments mới — báo Hỏng/Hủy trực tiếp từ tồn kho (source=
// 'STOCK', outcome chỉ 'HONG' hoặc 'HUY') hoặc thu hồi lại từ 1 nhân viên (source='EMPLOYEE', outcome
// 'TON' = về lại tồn kho, hoặc 'HONG'/'HUY' = phát hiện hỏng/hủy lúc thu hồi). Chỉ Giám Đốc Siêu Thị
// (canManageUniformStore) thực hiện, PHẠM VI CHÍNH SIÊU THỊ MÌNH — cùng khoá 'uniform_store:'+user.dept
// với buildUniformIssuance() để 2 thao tác gần như đồng thời không cùng vượt tồn/vượt số đang giữ.
// Lý do (reason) BẮT BUỘC theo yêu cầu nghiệp vụ (không cho để trống).
function buildUniformStockAdjustment(user, payload, allPeriods, allIssuancesOfStore, allAdjustmentsOfStore, usersList, allApprovedTransfers) {
  if (!canManageUniformStore(user)) throw new HttpError(403, 'Bạn không có quyền thao tác này');

  const source = String(payload?.source || '').trim().toUpperCase();
  if (source !== 'STOCK' && source !== 'EMPLOYEE') throw new HttpError(400, 'Nguồn thao tác không hợp lệ');

  const outcome = String(payload?.outcome || '').trim().toUpperCase();
  // MAT (làm mất) CHỈ áp dụng cho source EMPLOYEE — đồ đã cấp cho nhân viên bị thất lạc; hàng còn nằm
  // trong kho (source STOCK) chưa từng ra khỏi kho thì không có khái niệm "làm mất", chỉ Hỏng/Hủy.
  const validOutcomes = source === 'EMPLOYEE' ? ['TON', 'HONG', 'HUY', 'MAT'] : ['HONG', 'HUY'];
  if (!validOutcomes.includes(outcome)) throw new HttpError(400, 'Kết quả thao tác không hợp lệ');

  const itemName = String(payload?.itemName || '').trim().slice(0, 200);
  const size = String(payload?.size || '').trim().slice(0, 30);
  const qty = Math.floor(Number(payload?.qty));
  if (!itemName) throw new HttpError(400, 'Thiếu tên mặt hàng');
  if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'Số lượng phải lớn hơn 0');

  const reason = String(payload?.reason || '').trim().slice(0, 500);
  if (!reason) throw new HttpError(400, 'Vui lòng nhập lý do');

  const record = {
    id: Date.now(),
    dept: user.dept, deptName: user.dept,
    creator: user.username, creatorName: user.name,
    source, outcome, itemName, size, qty, reason,
    createdAt: nowVN()
  };

  if (source === 'STOCK') {
    const stock = computeUniformStock(allPeriods, user.dept, allIssuancesOfStore, allAdjustmentsOfStore, allApprovedTransfers);
    const row = stock.get(`${itemName}|||${size}`);
    const available = row ? row.stock : 0;
    if (qty > available) {
      throw new HttpError(409, `Không đủ tồn kho "${itemName}"${size ? ` (size ${size})` : ''}: còn ${available}, cần báo ${qty}`);
    }
    return record;
  }

  // source === 'EMPLOYEE'
  const employeeUsername = String(payload?.employeeUsername || '').trim();
  const employee = (usersList || []).find(u => u.username === employeeUsername && u.active !== false);
  if (!employee) throw new HttpError(400, 'Không tìm thấy nhân viên này (hoặc tài khoản đã bị khoá)');
  if (employee.dept !== user.dept) throw new HttpError(400, 'Chỉ thu hồi được của nhân viên thuộc siêu thị của bạn');

  const holding = computeEmployeeUniformHolding(employeeUsername, allIssuancesOfStore, allAdjustmentsOfStore);
  const held = holding.get(`${itemName}|||${size}`) || 0;
  if (qty > held) {
    throw new HttpError(409, `Nhân viên chỉ đang giữ ${held} "${itemName}"${size ? ` (size ${size})` : ''}, không thể thu hồi ${qty}`);
  }

  record.employeeUsername = employee.username;
  record.employeeName = employee.name;
  return record;
}

// ===== Điều Chuyển Kho Giữa Các Siêu Thị (uniformTransfers, Phase 2) =====
// Giám Đốc Siêu Thị NGUỒN (canManageUniformStore) tự yêu cầu điều chuyển 1 mặt hàng+size sang 1 siêu
// thị KHÁC — DÙNG CHUNG quyền duyệt uniformApprove với kỳ cấp phát (canApproveUniform() ở trên, đã xác
// nhận với người dùng — KHÔNG tạo quyền riêng). PENDING_APPROVAL -> APPROVED (stock nguồn giảm/đích
// tăng NGAY khi duyệt, xem computeUniformStock() tham số allApprovedTransfers) | REJECTED (TERMINAL,
// cùng khuôn approveUniformPeriod()/rejectUniformPeriod() ở trên — kiểm tra lại status server-side ở
// MỌI hành động, không chỉ chặn ở giao diện). routes/records.js chịu trách nhiệm khoá ĐỒNG THỜI 2 khoá
// 'uniform_store:<sourceDept>' + 'uniform_store:<targetDept>' (thứ tự CỐ ĐỊNH, xem withAppLock() ở
// lib/recordStore.js) lúc duyệt — 2 siêu thị cùng bị ảnh hưởng 1 lúc, khác các hành động khác của module
// này (chỉ đụng 1 siêu thị/lần).
function canApproveUniformTransfer(user) {
  return canApproveUniform(user);
}

// allPeriods/allIssuancesOfSourceStore/allAdjustmentsOfSourceStore/allApprovedTransfers: CỦA ĐÚNG siêu
// thị NGUỒN (= user.dept, caller tự lọc trước khi gọi, giống mọi hàm build...() khác của module này).
function buildUniformTransfer(user, payload, allPeriods, allIssuancesOfSourceStore, allAdjustmentsOfSourceStore, allApprovedTransfers) {
  if (!canManageUniformStore(user)) throw new HttpError(403, 'Bạn không có quyền yêu cầu điều chuyển kho');
  const sourceDept = user.dept; // luôn = siêu thị của người yêu cầu, không cho tự chọn siêu thị khác làm nguồn
  const targetDept = String(payload?.targetDept || '').trim();
  if (!targetDept) throw new HttpError(400, 'Vui lòng chọn siêu thị nhận điều chuyển');
  if (targetDept === sourceDept) throw new HttpError(400, 'Siêu thị nhận phải khác siêu thị nguồn');

  const itemName = String(payload?.itemName || '').trim().slice(0, 200);
  const size = String(payload?.size || '').trim().slice(0, 30);
  const qty = Math.floor(Number(payload?.qty));
  if (!itemName) throw new HttpError(400, 'Thiếu tên mặt hàng');
  if (!Number.isFinite(qty) || qty <= 0) throw new HttpError(400, 'Số lượng phải lớn hơn 0');
  const reason = String(payload?.reason || '').trim().slice(0, 500);
  if (!reason) throw new HttpError(400, 'Vui lòng nhập lý do điều chuyển');

  const stock = computeUniformStock(allPeriods, sourceDept, allIssuancesOfSourceStore, allAdjustmentsOfSourceStore, allApprovedTransfers);
  const row = stock.get(`${itemName}|||${size}`);
  const available = row ? row.stock : 0;
  if (qty > available) {
    throw new HttpError(409, `Không đủ tồn kho "${itemName}"${size ? ` (size ${size})` : ''} tại siêu thị nguồn: còn ${available}, cần chuyển ${qty}`);
  }

  return {
    id: Date.now(),
    sourceDept, targetDept, itemName, size, qty, reason,
    status: 'PENDING_APPROVAL',
    requestedBy: user.username, requestedByName: user.name, requestedAt: nowVN(),
    approvedBy: null, approvedByName: null, approvedAt: null, rejectReason: ''
  };
}

// Kiểm tra LẠI tồn kho nguồn tại thời điểm DUYỆT (không chỉ tin số liệu lúc yêu cầu — có thể đã có cấp
// phát/báo hỏng/điều chuyển khác xen giữa) — caller (routes/records.js) truyền vào stock CỦA SIÊU THỊ
// NGUỒN đã tính sẵn dưới khoá kép, KHÔNG loại trừ transfer đang xét (nó chưa APPROVED nên chưa được
// tính vào allApprovedTransfers tại thời điểm gọi).
function approveUniformTransfer(user, transfer, sourceStock) {
  if (!canApproveUniformTransfer(user)) throw new HttpError(403, 'Bạn không có quyền duyệt điều chuyển kho');
  if (transfer.status !== 'PENDING_APPROVAL') throw new HttpError(409, 'Yêu cầu điều chuyển này đã được xử lý trước đó');
  const row = sourceStock ? sourceStock.get(`${transfer.itemName}|||${transfer.size}`) : null;
  const available = row ? row.stock : 0;
  if (transfer.qty > available) {
    throw new HttpError(409, `Siêu thị nguồn không còn đủ tồn kho "${transfer.itemName}"${transfer.size ? ` (size ${transfer.size})` : ''}: còn ${available}, cần chuyển ${transfer.qty}`);
  }
  transfer.status = 'APPROVED';
  transfer.approvedBy = user.username;
  transfer.approvedByName = user.name;
  transfer.approvedAt = nowVN();
  return transfer;
}

function rejectUniformTransfer(user, transfer, payload) {
  if (!canApproveUniformTransfer(user)) throw new HttpError(403, 'Bạn không có quyền duyệt điều chuyển kho');
  if (transfer.status !== 'PENDING_APPROVAL') throw new HttpError(409, 'Yêu cầu điều chuyển này đã được xử lý trước đó');
  transfer.status = 'REJECTED';
  transfer.approvedBy = user.username;
  transfer.approvedByName = user.name;
  transfer.approvedAt = nowVN();
  transfer.rejectReason = String(payload?.reason || '').trim().slice(0, 500);
  return transfer;
}

// ===================== NGÂN SÁCH (kỳ: đóng sớm/mở lại — bản ngân sách phòng ban: nháp/gửi/duyệt) =====
// Vòng đời kỳ: OPEN (nhận lập ngân sách, tới khi qua endTime HOẶC budgetManage/admin đóng sớm) -> CLOSED
// -> có thể MỞ LẠI (budgetManage/admin, bắt buộc nhập hạn chót mới) -> OPEN trở lại.
// Vòng đời 1 bản ngân sách (budgetEntries, khoá theo PHÒNG BAN — không phải người tạo, vì đây là ngân
// sách của ĐƠN VỊ, nhiều người cùng phòng có quyền budgetCreate cùng lập/sửa được): DRAFT (đang soạn,
// sửa tự do) -> Gửi -> PENDING (Trưởng phòng duyệt theo appData.budgetDeptWorkflows[dept], qua
// lib/workflowEngine.js — xem MODULE_CONFIGS.budgetEntries, supportsRequestChanges:true) -> APPROVED
// (mới tính vào Tổng Hợp) | REJECTED, hoặc "Yêu cầu bổ sung" (REQUEST_CHANGES, hành động CHUNG với VPP)
// đưa PENDING quay lại DRAFT để phòng ban sửa lại rồi gửi lại từ đầu.
function canManageBudget(user) {
  return !!(user.perms?.admin || user.perms?.budgetManage);
}

function canAggregateBudget(user) {
  return !!(user.perms?.admin || user.perms?.budgetAggregate);
}

function isBudgetPeriodClosed(period) {
  if (period.status === 'CLOSED') return true;
  return !!(period.endTime && Date.now() > new Date(period.endTime).getTime());
}

// Đóng SỚM (trước endTime) — giống closeReportPeriod()/closeVppPeriod(). Đóng rồi thì budgetEntries
// không tạo/sửa/gửi được nữa dù đang NHÁP.
function closeBudgetPeriod(user, period) {
  if (!canManageBudget(user)) throw new HttpError(403, 'Chỉ người có quyền quản lý Ngân Sách mới được đóng kỳ ngân sách');
  if (period.status === 'CLOSED') throw new HttpError(409, 'Kỳ ngân sách này đã đóng từ trước');
  period.status = 'CLOSED';
  if (!period.closeHistory) period.closeHistory = [];
  period.closeHistory.push({ action: 'CLOSE', by: user.username, byName: user.name, at: nowVN() });
  return period;
}

// Mở lại kỳ đã đóng (thủ công hoặc do hết hạn) — BẮT BUỘC nhập hạn chót MỚI ngay lúc mở lại, tránh
// trạng thái "đang mở" nhưng hạn cũ đã qua từ trước (vô nghĩa) — xem lib/createValidation.js.
function reopenBudgetPeriod(user, period, newEndTime) {
  if (!canManageBudget(user)) throw new HttpError(403, 'Chỉ người có quyền quản lý Ngân Sách mới được mở lại kỳ ngân sách');
  if (!isBudgetPeriodClosed(period)) throw new HttpError(409, 'Kỳ ngân sách này đang mở, không cần mở lại');
  if (!newEndTime) throw new HttpError(400, 'Vui lòng nhập hạn chót mới khi mở lại kỳ');
  if (new Date(newEndTime).getTime() <= Date.now()) throw new HttpError(400, 'Hạn chót mới phải ở trong tương lai');
  period.status = 'OPEN';
  period.endTime = newEndTime;
  if (!period.closeHistory) period.closeHistory = [];
  period.closeHistory.push({ action: 'REOPEN', by: user.username, byName: user.name, at: nowVN() });
  return period;
}

// Sửa 1 bản ngân sách còn NHÁP (kể cả vừa bị trả về từ "Yêu cầu bổ sung") — khoá theo PHÒNG BAN, khác
// hẳn updateReportEntryDraft()/updateVppRegistrationDraft() (khoá creator) vì đây là "ngân sách của đơn
// vị", không phải hồ sơ cá nhân.
function updateBudgetEntryDraft(user, item, payload, period, templates) {
  if (!user.perms?.admin && !user.perms?.budgetCreate) throw new HttpError(403, 'Bạn không có quyền lập ngân sách');
  if (item.dept !== user.dept) throw new HttpError(403, 'Bạn chỉ sửa được ngân sách của phòng ban mình');
  if (item.status !== 'DRAFT') throw new HttpError(409, 'Ngân sách này không còn ở trạng thái nháp, không thể sửa');
  if (!period) throw new HttpError(404, 'Không tìm thấy kỳ ngân sách');
  if (isBudgetPeriodClosed(period)) throw new HttpError(409, 'Kỳ ngân sách này đã kết thúc, không thể sửa nữa');
  const customFields = getBudgetTemplateCustomFields(period.templateId, templates);
  item.lines = sanitizeBudgetLines(payload?.lines, customFields);
  return item;
}

// "Gửi": NHÁP -> PENDING, khởi động (lại) luồng duyệt Trưởng phòng từ bước 1 — kể cả khi gửi lại sau
// "Yêu cầu bổ sung" (item.history đã có sẵn dòng REQUEST_CHANGES từ lib/workflowEngine.js, giữ nguyên
// làm dấu vết, không xoá).
function submitBudgetEntry(user, item, period) {
  if (!user.perms?.admin && !user.perms?.budgetCreate) throw new HttpError(403, 'Bạn không có quyền lập ngân sách');
  if (item.dept !== user.dept) throw new HttpError(403, 'Bạn chỉ gửi được ngân sách của phòng ban mình');
  if (item.status !== 'DRAFT') throw new HttpError(409, 'Ngân sách này không còn ở trạng thái nháp (có thể đã gửi rồi)');
  if (!period) throw new HttpError(404, 'Không tìm thấy kỳ ngân sách');
  if (isBudgetPeriodClosed(period)) throw new HttpError(409, 'Kỳ ngân sách này đã kết thúc, không thể gửi nữa');
  if (!item.lines || !item.lines.length) throw new HttpError(400, 'Vui lòng nhập ít nhất 1 dòng ngân sách trước khi gửi');
  if (!item.history) item.history = [];
  item.history.push({ step: 0, approver: user.name, username: user.username, action: 'SUBMITTED', comment: '', time: nowVN() });
  item.status = 'PENDING';
  item.currentStep = 1;
  return item;
}

// Sửa tên/cột bổ sung của 1 mẫu ngân sách đã tạo — cùng khuôn updateReportSlideTemplate() ở trên.
function updateBudgetTemplate(user, item, payload) {
  if (!canManageBudget(user)) throw new HttpError(403, 'Chỉ người có quyền quản lý Ngân Sách mới được sửa mẫu ngân sách');
  const name = String(payload?.name || '').trim();
  if (!name) throw new HttpError(400, 'Thiếu tên mẫu ngân sách');
  item.name = name.slice(0, 150);
  item.fields = sanitizeBudgetCustomFields(payload?.fields);
  return item;
}

// ===================== ĐĂNG KÝ XE (Lái Xe tự xác nhận) =====
// Lái xe được phân công (carReg.assignedDriverUsername, gán lúc duyệt — xem applyWorkflowAction() ở
// lib/workflowEngine.js) tự vào sub-tab "Lái Xe" xác nhận đúng chuyến của mình, giống khuôn tự-xác-nhận
// đã dùng cho confirmUniformAllocation() ở trên — chỉ đúng người được gán mới xác nhận được.
function canConfirmCarDriverAssignment(user, carReg) {
  return !!(carReg?.assignedDriverUsername && user?.username === carReg.assignedDriverUsername);
}

function confirmCarDriverAssignment(user, carReg) {
  if (!canConfirmCarDriverAssignment(user, carReg)) {
    throw new HttpError(403, 'Bạn không phải là lái xe được phân công cho phiếu đăng ký này');
  }
  if (carReg.status !== 'APPROVED') {
    throw new HttpError(409, 'Chỉ xác nhận được khi phiếu đăng ký đã được phê duyệt xong toàn bộ');
  }
  if (carReg.driverConfirmed) {
    throw new HttpError(409, 'Phiếu đăng ký này đã được xác nhận trước đó');
  }
  carReg.driverConfirmed = true;
  carReg.driverConfirmedAt = nowVN();
  return carReg;
}

module.exports = {
  editContract,
  editDocDraft, submitDocDraft,
  editCarRegDraft, submitCarRegDraft,
  editOfficeReqDraft, submitOfficeReqDraft,
  editSubmissionDraft, submitSubmissionDraft,
  canManageContractPayment, uploadContractSignedFile, startContractPayment,
  canManageOfficePayment, uploadOfficeSignedFile, startOfficePayment,
  canManagePaymentRequests, editPaymentRequest, requestPaymentInfo, approvePaymentRequest,
  confirmPaymentInstallment, assertCanDeletePaymentRequest,
  canEditMinutes, canDeleteMinutes, editMinutes, assertCanDeleteMinutes,
  canCreateMinutes, createMinutes, buildTasksFromDirectives, assignMinutesTasks, buildTaskFromSubmissionComment,
  markInternalPostRead, toggleInternalPostLike, toggleInternalPostCommentLike, addInternalPostComment,
  scanCommentForSensitiveContent, dismissInternalCommentFlag, deleteInternalPostComment,
  registerInternalPostTraining, unregisterInternalPostTraining,
  canApproveInternalPost, approveInternalPost, rejectInternalPost,
  requestInternalPostInfo, hideInternalPost, unhideInternalPost, editInternalPost,
  canManageTasks, canDeleteTaskPerm, canAssignSpecificTask, assignTask, editTask, assertCanDeleteTask,
  createTask,
  acceptTask, confirmCollaboratorParticipation, updateTaskStatusAction, requestExtension,
  cancelOrRequestCancelTask, resolvePendingTaskAction,
  addSubtask, toggleSubtask, deleteSubtask,
  closeVppPeriod, submitVppRegistration, updateVppRegistrationDraft,
  closeReportPeriod, submitReportEntry, updateReportEntryDraft,
  mergeReportPeriod, mergeReportPeriodByTasks, updateReportCompilation, publishReportPeriod, unpublishReportPeriod,
  updateReportSlideTemplate,
  canManageTraining, canManageTrainingClass, cancelTrainingRegistration, approveCancelTrainingRegistration,
  rejectCancelTrainingRegistration, markTrainingDocumentViewed, setTrainingRegistrationResult, confirmCareerPathForEmployee,
  bulkRegisterTrainingClass, editTrainingClass, startOfflineTrainingClass, endOfflineTrainingClass, editTrainingPlan,
  gradeTrainingTestSubmission, applyAutoGradedTestResult,
  editOnboardingPath, confirmOnboardingStage, canEvaluateOnboardingStage3, evaluateOnboardingStage3, issueOnboardingCertificate,
  canManageRecruitment, closeRecruitmentJob, confirmRecruitmentJobFilled, setRecruitmentReferralStatus,
  canManageItSupport, applyPriceApproval, claimPriceApply, releasePriceApplyClaim, requestPriceInfoFromIt, submitPriceSupplementFile,
  claimItTicket, updateItTicketStatus, addItTicketComment, cancelItTicket,
  escalateItTicket, approveItTicketEscalation, denyItTicketEscalation,
  canManageUniform, canManageUniformStore, computeUniformStock, computeEmployeeUniformHolding,
  computeAllEmployeeUniformHoldings,
  canApproveUniform, approveUniformPeriod, rejectUniformPeriod,
  stripVietnameseDiacritics, abbreviateUniformItemName, computeNextUniformSkuSeq, generateUniformSkuCode, backfillUniformSkuCodes,
  confirmUniformAllocation, buildUniformIssuance, buildUniformStockAdjustment,
  canApproveUniformTransfer, buildUniformTransfer, approveUniformTransfer, rejectUniformTransfer,
  canManageBudget, canAggregateBudget, isBudgetPeriodClosed,
  closeBudgetPeriod, reopenBudgetPeriod, updateBudgetEntryDraft, submitBudgetEntry, updateBudgetTemplate,
  canConfirmCarDriverAssignment, confirmCarDriverAssignment
};
