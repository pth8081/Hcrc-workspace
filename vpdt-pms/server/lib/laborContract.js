// lib/laborContract.js — Hợp Đồng Lao Động (Labor Contract), Phần D tài liệu thiết kế tổng thể module
// Nhân Sự — Đợt 2/4 (Hồ Sơ [đã xong] → Hợp Đồng Lao Động → Công & Phép → vá lại Phần A/B).
//
// KIẾN TRÚC (đã xác nhận với người dùng, xem thêm ghi chú đầu lib/employeeProfile.js cho tinh thần
// chung "chuyển từ bảng SQL chuẩn hoá sang JSON-blob của app này"):
//   1. dbo.Records (KHÔNG phải AppData array thuần như employeeProfiles) — mỗi hợp đồng 1 bản ghi khoá
//      optimistic riêng (xem MIGRATED_COLLECTIONS ở lib/recordStore.js), vì cron cảnh báo hết hạn
//      (jobs/laborContractExpiryReminder.js) ghi notifiedThresholds đồng thời HR có thể sửa tay — tách
//      khoá theo từng bản ghi tránh nghẽn khoá 1 mảng lớn dùng chung (khác employeeProfiles vốn ít ghi
//      đồng thời hơn nhiều).
//   2. KHÔNG có bước phê duyệt nội bộ nào (khác hẳn module "Hợp Đồng" — dbKey 'contracts' — vốn là hợp
//      đồng mua bán/nhà cung cấp có luồng duyệt theo phòng ban) — HR (hrContractManage) toàn quyền CRUD
//      trực tiếp, đúng tinh thần tài liệu gốc Phần D (không hề nhắc bước duyệt nào cho Hợp Đồng Lao Động).
//   3. Vòng đời tự động hoá qua 3 mốc trong checklist Onboarding (xem defaults.js hrTaskTemplates + hook
//      ở routes/records.js::syncLaborContractOnHrTaskEvent()):
//      - templateId=1 "Gửi thư mời nhận việc & hợp đồng lao động" (PRE_BOARDING) hoàn thành -> tạo bản
//        nháp hợp đồng THỬ VIỆC (status DRAFT) — xem buildProbationDraftPayload().
//      - templateId=7 "Đón tiếp, ký hợp đồng chính thức" (FIRST_DAY) hoàn thành -> kích hoạt hợp đồng
//        thử việc (DRAFT -> ACTIVE) — xem applyActivateProbation().
//      - templateId=15 "Ra quyết định: ký chính thức/gia hạn/chấm dứt" (PROBATION_REVIEW) hoàn thành,
//        kèm body.decision — xem applyPostProbationDecision(). CHỈ hỗ trợ 2 quyết định thực tế
//        SIGN_OFFICIAL/TERMINATE (bỏ "gia hạn thử việc" — không phải luồng phổ biến theo Bộ luật Lao
//        động VN, thử việc không được gia hạn/lặp lại; việc tiếp tục gia hạn HỢP ĐỒNG CHÍNH THỨC sau
//        này là 1 thao tác tay riêng của HR, kích hoạt bởi cảnh báo cron sắp hết hạn — xem mục 4 dưới).
//   4. Cron cảnh báo hết hạn hợp đồng (Phần D.2 — "nghiệp vụ quan trọng nhất") ĐƯA VÀO đợt này luôn, xem
//      jobs/laborContractExpiryReminder.js (nhân bản khuôn jobs/licenseExpiryReminder.js).
//   5. Phần J tài liệu gốc: "thời hạn thử việc chính xác theo từng loại vị trí CẦN HR/pháp chế xác
//      nhận lại" — GIỮ NGUYÊN cách hiện tại (targetEndDate ước tính 60 ngày cố định ở
//      lib/createValidation.js hrProcesses.extraValidate, xem dòng ~2493) làm mốc HIỂN THỊ tham khảo
//      cho endDate của hợp đồng thử việc — KHÔNG thêm ràng buộc cứng theo loại vị trí ở đợt này.
const { randomUUID } = require('crypto');
const { HttpError } = require('./httpErrors');

function nowVN() {
  return new Date().toLocaleString('vi-VN');
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

const CONTRACT_TYPES = new Set(['PROBATION', 'FIXED_TERM', 'INDEFINITE']);
const STATUSES = new Set(['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'SUPERSEDED']);
// SIGN_OFFICIAL: thử việc đạt yêu cầu -> ký hợp đồng chính thức (FIXED_TERM/INDEFINITE tuỳ số lần gia
// hạn trước đó). TERMINATE: không tiếp tục sử dụng lao động sau thử việc.
const POST_PROBATION_DECISIONS = new Set(['SIGN_OFFICIAL', 'TERMINATE']);

function canManageContracts(user) {
  return !!(user?.perms?.admin || user?.perms?.hrContractManage);
}

function findContractsByEmployeeCode(list, employeeCode) {
  return (list || []).filter(c => c.employeeCode === employeeCode);
}

// Hợp đồng đang ACTIVE của 1 nhân viên — dùng cho cron cảnh báo hết hạn + tra cứu khi Offboarding hoàn
// tất. Mỗi thời điểm chỉ nên có ĐÚNG 1 hợp đồng ACTIVE cho 1 employeeCode (hợp đồng trước bị đóng
// SUPERSEDED/TERMINATED ngay khi hợp đồng kế tiếp phát sinh — xem applyPostProbationDecision()).
function findActiveContractByEmployeeCode(list, employeeCode) {
  return (list || []).find(c => c.employeeCode === employeeCode && c.status === 'ACTIVE') || null;
}

// Bản ghi MỚI NHẤT (id lớn nhất) thuộc về 1 quy trình Onboarding — dùng để tìm đúng hợp đồng thử việc
// vừa tạo/kích hoạt ở các hook templateId=1/7/15 (tất cả đều còn đang trong CÙNG 1 hrProcessItem.id).
function findLatestContractForProcess(list, hrProcessId) {
  const family = (list || []).filter(c => c.hrProcessId === hrProcessId);
  if (!family.length) return null;
  return family.reduce((a, b) => (b.id > a.id ? b : a));
}

// Mã hợp đồng tự sinh — KHÔNG trùng với generateContractCode()/contractTypeAbbrs của module "Hợp Đồng"
// (mua bán/nhà cung cấp) ở public/js/module-hopdong.js, đây là hàm RIÊNG, độc lập hoàn toàn.
function generateContractCode(list, employeeCode) {
  const seq = findContractsByEmployeeCode(list, employeeCode).length + 1;
  return `HDLD-${employeeCode}-${seq}`;
}

function defaultContract(overrides) {
  return Object.assign({
    code: null, employeeCode: null, employeeUsername: null, hrProcessId: null,
    contractType: 'PROBATION', renewalIndex: 0,
    startDate: null, endDate: null, baseSalary: null,
    status: 'DRAFT',
    terminationDate: null, terminationReason: null,
    fileUrl: null, fileName: null,
    amendments: [], notifiedThresholds: [],
    history: [],
    creator: 'system', creatorName: 'Hệ Thống (Tự Động)', dept: null,
    createdAt: nowVN(), updatedAt: nowVN(), updatedBy: 'system'
  }, overrides || {});
}

// templateId=1 "Gửi thư mời nhận việc & hợp đồng lao động" hoàn thành -> tạo bản nháp hợp đồng thử
// việc. Idempotent: nếu quy trình này đã có hợp đồng nào rồi (VD hoàn thành lại task do sửa sai) thì
// KHÔNG tạo trùng — trả về null để caller biết không cần insert gì.
function buildProbationDraftPayload(hrProcessItem, existingList) {
  if (findLatestContractForProcess(existingList, hrProcessItem.id)) return null;
  return defaultContract({
    code: generateContractCode(existingList, hrProcessItem.employeeCode),
    employeeCode: hrProcessItem.employeeCode,
    hrProcessId: hrProcessItem.id,
    contractType: 'PROBATION', renewalIndex: 0,
    startDate: hrProcessItem.startDate || null,
    endDate: hrProcessItem.targetEndDate || null,
    dept: hrProcessItem.employeeDept || null,
    status: 'DRAFT',
    history: [{
      action: 'CREATED', by: 'system', byName: 'Hệ Thống (Tự Động)', time: nowVN(),
      detail: 'Tự tạo bản nháp hợp đồng thử việc khi hoàn thành việc "Gửi thư mời nhận việc & hợp đồng lao động"'
    }]
  });
}

// templateId=7 "Đón tiếp, ký hợp đồng chính thức" (FIRST_DAY) hoàn thành -> kích hoạt hợp đồng thử
// việc DRAFT -> ACTIVE. Mutate tại chỗ (caller đã khoá đúng bản ghi qua withLockedRecordForCollection).
function applyActivateProbation(contract, hrProcessItem) {
  if (!contract || contract.status !== 'DRAFT') return contract; // không tồn tại hoặc đã kích hoạt rồi (idempotent)
  contract.status = 'ACTIVE';
  if (hrProcessItem.startDate) contract.startDate = hrProcessItem.startDate;
  contract.history.push({
    action: 'ACTIVATED', by: 'system', byName: 'Hệ Thống (Tự Động)', time: nowVN(),
    detail: 'Tự kích hoạt khi hoàn thành việc "Đón tiếp, ký hợp đồng chính thức"'
  });
  contract.updatedAt = nowVN(); contract.updatedBy = 'system';
  return contract;
}

// Loại + số lần gia hạn của hợp đồng KẾ TIẾP sau 1 hợp đồng PROBATION đạt yêu cầu — theo đúng vòng đời
// Phần D.1: PROBATION qua -> FIXED_TERM (lần 1); tối đa 2 lần gia hạn FIXED_TERM liên tiếp, lần thứ 3
// trở đi BẮT BUỘC chuyển INDEFINITE (vô thời hạn). Hàm này CHỈ dùng cho nhánh tự động ngay sau thử việc
// (renewalIndex luôn 0 -> 1 ở đây) — các lần gia hạn FIXED_TERM tiếp theo (renewalIndex 1->2, 2->3...)
// là thao tác TAY của HR ở màn Hợp Đồng Lao Động (kích hoạt bởi cảnh báo cron sắp hết hạn), không qua
// hàm này.
function nextContractTypeAfterProbation() {
  return { contractType: 'FIXED_TERM', renewalIndex: 1 };
}

// HR gia hạn/đổi loại hợp đồng TAY (không qua hook Onboarding) — dùng CHUNG logic renewalIndex cho cả
// 2 nhánh (tự động sau thử việc lẫn gia hạn tay sau này), để 1 nơi duy nhất áp luật "quá 2 lần gia hạn
// FIXED_TERM phải chuyển INDEFINITE".
function nextContractTypeAndRenewal(prevType, prevRenewalIndex) {
  if (prevType === 'PROBATION') return nextContractTypeAfterProbation();
  const idx = (Number(prevRenewalIndex) || 0) + 1;
  return idx > 2 ? { contractType: 'INDEFINITE', renewalIndex: idx } : { contractType: 'FIXED_TERM', renewalIndex: idx };
}

// templateId=15 "Ra quyết định: ký chính thức/gia hạn/chấm dứt" hoàn thành, kèm body.decision.
// Trả về { closedContract, nextContractPayload } — closedContract là contract đã mutate tại chỗ (đóng
// lại), nextContractPayload là bản ghi MỚI cần insert (null nếu TERMINATE, không tạo hợp đồng kế tiếp).
function applyPostProbationDecision(contract, decision, existingList, actorUsername) {
  if (!contract) throw new HttpError(404, 'Không tìm thấy hợp đồng thử việc đang hiệu lực của quy trình này');
  if (contract.status !== 'ACTIVE') throw new HttpError(409, 'Hợp đồng thử việc không ở trạng thái đang hiệu lực (có thể đã được xử lý quyết định trước đó)');
  if (!POST_PROBATION_DECISIONS.has(decision)) {
    throw new HttpError(400, 'Quyết định không hợp lệ — chỉ nhận "Ký hợp đồng chính thức" hoặc "Chấm dứt sau thử việc"');
  }
  const nowStr = nowVN();
  if (decision === 'TERMINATE') {
    contract.status = 'TERMINATED';
    contract.terminationDate = todayISO();
    contract.terminationReason = 'Không đạt yêu cầu thử việc — chấm dứt theo quyết định Nhân Sự tại bước Đánh Giá Thử Việc';
    contract.history.push({ action: 'TERMINATED', by: actorUsername || 'system', byName: actorUsername || 'Hệ Thống', time: nowStr, detail: 'Chấm dứt sau thử việc' });
    contract.updatedAt = nowStr; contract.updatedBy = actorUsername || 'system';
    return { closedContract: contract, nextContractPayload: null };
  }
  // SIGN_OFFICIAL
  contract.status = 'SUPERSEDED';
  contract.history.push({ action: 'SUPERSEDED', by: actorUsername || 'system', byName: actorUsername || 'Hệ Thống', time: nowStr, detail: 'Thử việc đạt yêu cầu — chuyển sang hợp đồng chính thức' });
  contract.updatedAt = nowStr; contract.updatedBy = actorUsername || 'system';
  const { contractType, renewalIndex } = nextContractTypeAfterProbation();
  const nextContractPayload = defaultContract({
    code: generateContractCode(existingList, contract.employeeCode),
    employeeCode: contract.employeeCode,
    hrProcessId: contract.hrProcessId,
    contractType, renewalIndex,
    startDate: todayISO(), endDate: null, // HR điền cụ thể sau ở màn Hợp Đồng Lao Động (đã xác nhận với người dùng)
    dept: contract.dept,
    status: 'DRAFT',
    creator: actorUsername || 'system', creatorName: actorUsername || 'Hệ Thống (Tự Động)',
    history: [{
      action: 'CREATED', by: actorUsername || 'system', byName: actorUsername || 'Hệ Thống', time: nowStr,
      detail: 'Tự tạo bản nháp hợp đồng chính thức khi Nhân Sự quyết định "Ký hợp đồng chính thức" — cần điền lương/ngày hết hạn cụ thể rồi kích hoạt'
    }]
  });
  return { closedContract: contract, nextContractPayload };
}

// OFFBOARDING hoàn tất (COMPLETED) -> đóng hợp đồng đang ACTIVE của nhân viên này lại (nếu có).
function applyOffboardingTermination(contract, hrProcessItem) {
  if (!contract || contract.status !== 'ACTIVE') return contract; // không có hợp đồng active hoặc đã xử lý rồi
  contract.status = 'TERMINATED';
  contract.terminationDate = hrProcessItem.lastWorkingDate || todayISO();
  contract.terminationReason = 'Chấm dứt theo quy trình Offboarding';
  contract.history.push({
    action: 'TERMINATED', by: 'system', byName: 'Hệ Thống (Tự Động)', time: nowVN(),
    detail: 'Tự đóng hợp đồng khi quy trình Offboarding hoàn tất'
  });
  contract.updatedAt = nowVN(); contract.updatedBy = 'system';
  return contract;
}

// Trường HR sửa tay được (tạo mới thủ công/sửa hợp đồng đã có) — KHÔNG gồm code/employeeCode/
// hrProcessId/status/renewalIndex/history/amendments/notifiedThresholds (đổi qua các hàm riêng ở trên/
// dưới, không cho ghi đè tự do qua đây).
const MANUAL_EDITABLE_FIELDS = ['contractType', 'startDate', 'endDate', 'baseSalary', 'fileUrl', 'fileName', 'dept'];

// Nhãn hiển thị cho từng field sửa tay — dùng để ghi dòng lịch sử "MANUAL_EDIT" bên dưới (VD HR tăng
// lương trực tiếp trên hợp đồng đang hiệu lực thay vì tạo hẳn hợp đồng mới/thêm phụ lục — trước đây
// hành động này KHÔNG để lại dấu vết gì trong history[], khiến "lịch sử tăng lương" biến mất hoàn toàn
// nếu HR chọn sửa thẳng — xem yêu cầu "Lịch Sử Nhân Sự xuyên suốt" đã xác nhận với người dùng).
const MANUAL_EDIT_FIELD_LABELS = {
  contractType: 'Loại hợp đồng', startDate: 'Ngày hiệu lực', endDate: 'Ngày hết hạn',
  baseSalary: 'Lương cơ bản', fileUrl: 'Tệp hợp đồng', fileName: 'Tên tệp', dept: 'Phòng ban'
};
function applyManualEdit(contract, payload, actorUsername, actorName) {
  const body = payload || {};
  const changes = [];
  for (const field of MANUAL_EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    const val = body[field];
    let newVal;
    switch (field) {
      case 'contractType':
        if (!CONTRACT_TYPES.has(val)) throw new HttpError(400, 'Loại hợp đồng không hợp lệ');
        newVal = val;
        break;
      case 'baseSalary': {
        const n = val === '' || val === null || val === undefined ? null : Number(val);
        if (n !== null && (!Number.isFinite(n) || n < 0)) throw new HttpError(400, 'Lương cơ bản không hợp lệ');
        newVal = n;
        break;
      }
      case 'startDate': case 'endDate':
        if (val != null && val !== '' && isNaN(new Date(val).getTime())) throw new HttpError(400, 'Ngày không hợp lệ');
        newVal = val || null;
        break;
      default:
        newVal = val == null ? null : String(val).trim().slice(0, 300);
    }
    if (contract[field] !== newVal) changes.push({ field, oldValue: contract[field], newValue: newVal });
    contract[field] = newVal;
  }
  if (contract.startDate && contract.endDate && contract.contractType !== 'INDEFINITE' && contract.startDate > contract.endDate) {
    throw new HttpError(400, 'Ngày hiệu lực phải trước ngày hết hạn');
  }
  if (changes.length) {
    const detail = changes.map(c => `${MANUAL_EDIT_FIELD_LABELS[c.field] || c.field}: "${c.oldValue ?? '(trống)'}" → "${c.newValue ?? '(trống)'}"`).join('; ');
    contract.history.push({ action: 'MANUAL_EDIT', by: actorUsername, byName: actorName || actorUsername, time: nowVN(), detail });
  }
  contract.updatedAt = nowVN(); contract.updatedBy = actorUsername;
}

// HR kích hoạt tay 1 hợp đồng DRAFT (dùng cho hợp đồng chính thức tự tạo ở applyPostProbationDecision()
// sau khi HR đã điền đủ lương/ngày hết hạn, hoặc hợp đồng tạo thủ công hoàn toàn) — đóng hợp đồng ACTIVE
// cũ (nếu có, khác bản ghi này) thành SUPERSEDED để đảm bảo bất biến "chỉ 1 hợp đồng ACTIVE/nhân viên".
function assertReadyToActivate(contract) {
  if (contract.status !== 'DRAFT') throw new HttpError(409, 'Chỉ kích hoạt được hợp đồng đang ở trạng thái Nháp');
  if (!contract.startDate) throw new HttpError(400, 'Vui lòng nhập Ngày hiệu lực trước khi kích hoạt');
  if (contract.contractType !== 'INDEFINITE' && !contract.endDate) {
    throw new HttpError(400, 'Vui lòng nhập Ngày hết hạn trước khi kích hoạt (chỉ hợp đồng Vô thời hạn mới bỏ trống được)');
  }
}
function applyActivateManual(contract, actorUsername) {
  assertReadyToActivate(contract);
  contract.status = 'ACTIVE';
  contract.history.push({ action: 'ACTIVATED', by: actorUsername, byName: actorUsername, time: nowVN(), detail: 'Kích hoạt hợp đồng' });
  contract.updatedAt = nowVN(); contract.updatedBy = actorUsername;
  return contract;
}

function assertValidAmendment(payload) {
  if (!payload?.amendmentType || !String(payload.amendmentType).trim()) throw new HttpError(400, 'Vui lòng nhập Loại thay đổi');
  if (!payload?.effectiveDate || isNaN(new Date(payload.effectiveDate).getTime())) throw new HttpError(400, 'Vui lòng nhập Ngày hiệu lực thay đổi hợp lệ');
}
function addAmendment(contract, payload, actorUsername, actorName) {
  assertValidAmendment(payload);
  const amendment = {
    id: randomUUID(),
    amendmentType: String(payload.amendmentType).trim().slice(0, 100),
    effectiveDate: String(payload.effectiveDate).trim(),
    oldValue: payload.oldValue ? String(payload.oldValue).trim().slice(0, 300) : null,
    newValue: payload.newValue ? String(payload.newValue).trim().slice(0, 300) : null,
    note: payload.note ? String(payload.note).trim().slice(0, 500) : null,
    createdAt: nowVN(), createdBy: actorUsername, createdByName: actorName || actorUsername
  };
  contract.amendments = [...(contract.amendments || []), amendment];
  contract.history.push({ action: 'AMENDMENT_ADDED', by: actorUsername, byName: actorName || actorUsername, time: nowVN(), detail: `Bổ sung thay đổi: ${amendment.amendmentType}` });
  contract.updatedAt = nowVN(); contract.updatedBy = actorUsername;
  return amendment;
}

function assertValidManualStatusTransition(currentStatus, nextStatus) {
  if (!STATUSES.has(nextStatus)) throw new HttpError(400, 'Trạng thái không hợp lệ');
  if (!['TERMINATED', 'EXPIRED'].includes(nextStatus)) {
    throw new HttpError(400, 'Chỉ chuyển tay được sang "Đã chấm dứt"/"Hết hạn" — các trạng thái khác do hệ thống tự đặt theo quy trình');
  }
  if (currentStatus !== 'ACTIVE') throw new HttpError(409, 'Chỉ đóng được hợp đồng đang hiệu lực (ACTIVE)');
}

module.exports = {
  CONTRACT_TYPES, STATUSES, POST_PROBATION_DECISIONS, MANUAL_EDITABLE_FIELDS,
  canManageContracts, findContractsByEmployeeCode, findActiveContractByEmployeeCode, findLatestContractForProcess,
  generateContractCode, defaultContract,
  buildProbationDraftPayload, applyActivateProbation, applyPostProbationDecision, applyOffboardingTermination,
  applyManualEdit, applyActivateManual, addAmendment, assertValidManualStatusTransition
};
