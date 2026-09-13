// lib/checklist.js — Module "Checklist Đánh Giá Siêu Thị" (module TOP-LEVEL riêng, đã chốt với người
// dùng qua trao đổi thiết kế — KHÔNG nhét vào Vận Hành). Kiến trúc dữ liệu là JSON-blob 2 collection
// (checklistTemplates/checklistSubmissions, MIGRATED_COLLECTIONS — xem lib/recordStore.js), KHÔNG
// dùng bảng SQL quan hệ riêng như tài liệu thiết kế gốc đề xuất (tài liệu đó viết cho 1 kiến trúc khác
// hẳn hệ thống này — Employees/PositionAssignments/OrgNodes/WorkLocationCode không tồn tại ở đây).
//
// 2 loại checklist, cơ chế gán siêu thị HOÀN TOÀN khác nhau:
//   - STORE_SELF: nhân viên siêu thị tự đánh giá — storeCode LUÔN suy ra từ user.dept khi
//     user.posType === 'STORE' (TUYỆT ĐỐI không tin storeCode client tự gửi lên, xem resolveStoreCodeForSubmission()).
//   - CONTROL_AUDIT: nhân viên Kiểm soát đánh giá — PHẢI tự chọn storeCode, giới hạn trong phạm vi
//     perms.checklistAuditScope ({all, depts} — "depts" ở đây là mảng TÊN SIÊU THỊ, dùng đúng tên field
//     "depts" để tái dùng NGUYÊN mergeGroupsBasePerms()/mergeGroupsBasePermsServer() sẵn có — 2 hàm đó
//     hardcode nhận diện field theo tên "depts", không nhận diện theo ý nghĩa, nên đổi tên field khác
//     (VD "stores") sẽ ÂM THẦM MẤT khả năng hợp (union) phạm vi khi 1 user thuộc nhiều Nhóm Phân Quyền).
//
// Phân quyền PHẲNG (đã chốt với người dùng — KHÔNG dùng ChecklistReportPermissions theo từng template
// như tài liệu gốc đề xuất):
//   - checklistTemplateManage: tạo/sửa (khi còn DRAFT)/nhân bản/kích hoạt/xoá template.
//   - checklistAuditScope {all,depts}: phạm vi siêu thị được làm CONTROL_AUDIT.
//   - checklistReportView: xem tab Báo Cáo (module-riêng, KHÔNG phải Báo Cáo tổng hợp).
// Quyền LÀM checklist STORE_SELF tự động (không cờ riêng) nếu user.posType==='STORE'. Quyền PHẢN HỒI
// kết quả CONTROL_AUDIT của siêu thị mình cũng tự động theo storeCode===user.dept.
'use strict';

const { HttpError } = require('./httpErrors');

const TEMPLATE_TYPES = new Set(['STORE_SELF', 'CONTROL_AUDIT']);
const TEMPLATE_STATUSES = new Set(['DRAFT', 'ACTIVE', 'ARCHIVED']);
const QUESTION_TYPES = new Set(['SINGLE_CHOICE', 'MULTIPLE_CHOICE']);

function nowVN() {
  return new Date().toLocaleString('vi-VN');
}

// ===================== Phân quyền (phẳng) =====================
function canManageChecklistTemplates(user) {
  return !!(user?.perms?.admin || user?.perms?.checklistTemplateManage);
}
function canViewChecklistReports(user) {
  return !!(user?.perms?.admin || user?.perms?.checklistReportView);
}
function getChecklistAuditStores(user) {
  if (user?.perms?.admin) return { all: true, depts: [] };
  return user?.perms?.checklistAuditScope || { all: false, depts: [] };
}
function hasChecklistAuditScope(user) {
  const scope = getChecklistAuditStores(user);
  return !!(scope?.all || (scope?.depts || []).length);
}
function canAuditStore(user, storeCode) {
  if (!storeCode) return false;
  const scope = getChecklistAuditStores(user);
  if (scope.all) return true;
  return (scope.depts || []).includes(storeCode);
}
// STORE_SELF — bất kỳ ai đang ở vị trí Siêu Thị (posType='STORE', xem v16.7) đều tự đánh giá được đúng
// siêu thị hiện tại của mình, không cần cờ quyền riêng (khớp đúng tinh thần tài liệu gốc: "tự động cho
// phép nếu vị trí có gắn siêu thị").
function isEligibleForStoreSelf(user) {
  return !!(user && user.posType === 'STORE' && user.dept);
}
function canAccessChecklistModule(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  if (canManageChecklistTemplates(user) || canViewChecklistReports(user)) return true;
  if (hasChecklistAuditScope(user)) return true;
  return isEligibleForStoreSelf(user);
}

// ===================== Validate Template (tạo mới/sửa khi còn DRAFT) =====================
// Mirror ĐÚNG khuôn createValidation.js::trainingTests (câu hỏi + lựa chọn nhúng thẳng trong template,
// không phải bảng quan hệ riêng) — chỉ khác: mỗi lựa chọn có thêm scoreValue/isPassing/isCriticalFail
// (thay vì correctOptionIds), và mỗi câu hỏi có thêm showIfOptionId (điều kiện hiển thị phân nhánh).
function validateChecklistQuestions(rawQuestions) {
  const list = Array.isArray(rawQuestions) ? rawQuestions : [];
  if (!list.length) throw new HttpError(400, 'Checklist cần ít nhất 1 câu hỏi');
  if (list.length > 200) throw new HttpError(400, 'Checklist tối đa 200 câu hỏi');

  // optionId ĐÁNH SỐ TOÀN CỤC xuyên suốt cả checklist (KHÔNG reset về 1 ở mỗi câu hỏi) — mirror đúng
  // "OptionId INT IDENTITY" của tài liệu thiết kế gốc (khoá tăng dần toàn bảng, không lặp lại giữa các
  // câu hỏi khác nhau). Bắt buộc phải làm vậy vì showIfOptionId chỉ mang 1 số nguyên — nếu optionId
  // reset về 1 ở mỗi câu hỏi (như đánh số cục bộ trainingTests.correctOptionIds), 1 con số duy nhất sẽ
  // KHÔNG xác định được rõ ràng "lựa chọn nào của câu hỏi nào" (câu 1 lựa chọn 1 và câu 5 lựa chọn 1 sẽ
  // cùng mang optionId=1) — showIfOptionId sẽ trỏ mơ hồ, có thể vô tình khớp SAI câu hỏi.
  let nextOptionId = 1;
  const questions = list.map((q, i) => {
    const text = String(q?.text || '').trim();
    if (!text) throw new HttpError(400, `Câu hỏi số ${i + 1} thiếu nội dung`);
    const type = QUESTION_TYPES.has(q?.type) ? q.type : 'SINGLE_CHOICE';
    const maxScore = Number(q?.maxScore) >= 0 ? Number(q.maxScore) : 0;
    const isRequired = q?.isRequired !== false;
    const note = q?.note ? String(q.note).trim().slice(0, 500) : '';

    const rawOptions = Array.isArray(q?.options) ? q.options : [];
    if (rawOptions.length < 2) throw new HttpError(400, `Câu hỏi số ${i + 1} cần ít nhất 2 lựa chọn`);
    if (rawOptions.length > 10) throw new HttpError(400, `Câu hỏi số ${i + 1} tối đa 10 lựa chọn`);
    const options = rawOptions.map((o, oi) => {
      const oText = String(o?.text || '').trim();
      if (!oText) throw new HttpError(400, `Lựa chọn số ${oi + 1} của câu hỏi số ${i + 1} thiếu nội dung`);
      return {
        id: nextOptionId++,
        text: oText,
        scoreValue: Number.isFinite(Number(o?.scoreValue)) ? Number(o.scoreValue) : 0,
        isPassing: o?.isPassing !== false,
        isCriticalFail: o?.isCriticalFail === true,
        displayOrder: oi + 1
      };
    });
    if (!options.some(o => o.isPassing)) {
      throw new HttpError(400, `Câu hỏi số ${i + 1} cần ít nhất 1 lựa chọn "Đạt"`);
    }
    return {
      id: i + 1, text, type, displayOrder: i + 1,
      showIfOptionId: null, // gán ở lượt duyệt thứ 2 bên dưới (cần biết hết optionId của MỌI câu trước đã)
      isRequired, maxScore, note, options
    };
  });

  // Lượt 2 — validate + gán showIfOptionId: client gửi optionId THẬT của câu hỏi ĐỨNG TRƯỚC (client tự
  // biết vì vừa hiển thị optionId đó trong lúc soạn — xem renderChecklistQuestionBuilder()) — PHẢI
  // thuộc 1 câu hỏi có displayOrder NHỎ HƠN câu đang xét (chặn vòng lặp/tự tham chiếu, Mục 5.3 tài liệu
  // gốc). "Câu trước" xác định bằng optionId < id của câu bắt đầu chứa showIfOptionId đó, vì optionId
  // đánh số tăng dần đúng theo thứ tự câu hỏi ở lượt 1 phía trên.
  list.forEach((q, i) => {
    const raw = q?.showIfOptionId;
    if (raw === undefined || raw === null || raw === '') return;
    const targetOptionId = Number(raw);
    const ownerQuestionIdx = questions.findIndex(qq => qq.options.some(o => o.id === targetOptionId));
    if (ownerQuestionIdx < 0 || ownerQuestionIdx >= i) {
      throw new HttpError(400, `Câu hỏi số ${i + 1}: điều kiện hiển thị phải trỏ tới 1 lựa chọn của câu hỏi đứng TRƯỚC nó`);
    }
    questions[i].showIfOptionId = targetOptionId;
  });

  return questions;
}

function assertTemplateCoreFields(payload) {
  const templateCode = String(payload?.templateCode || '').trim();
  const templateName = String(payload?.templateName || '').trim();
  if (!templateCode) throw new HttpError(400, 'Thiếu mã checklist (templateCode)');
  if (!templateName) throw new HttpError(400, 'Thiếu tên checklist');
  if (!TEMPLATE_TYPES.has(payload?.templateType)) throw new HttpError(400, 'Loại checklist không hợp lệ (STORE_SELF/CONTROL_AUDIT)');
  const passThreshold = payload?.passThreshold === null || payload?.passThreshold === undefined || payload?.passThreshold === ''
    ? null : Number(payload.passThreshold);
  if (passThreshold !== null && (!Number.isFinite(passThreshold) || passThreshold < 0 || passThreshold > 100)) {
    throw new HttpError(400, 'Ngưỡng điểm đạt (%) không hợp lệ');
  }
  return { templateCode: templateCode.slice(0, 50), templateName: templateName.slice(0, 200), templateType: payload.templateType, passThreshold };
}

// ===================== Mục 7.1 tài liệu gốc — điểm bảo mật cốt lõi =====================
// Xác định storeCode khi BẮT ĐẦU 1 submission — logic PHẢI nằm ở server, không tin bất kỳ giá trị nào
// client tự gửi cho STORE_SELF (mới đúng tinh thần "TUYỆT ĐỐI không dùng requestedStoreCode từ client"
// của tài liệu gốc).
function resolveStoreCodeForSubmission(template, user, requestedStoreCode) {
  if (template.templateType === 'STORE_SELF') {
    // Admin: cho phép TỰ CHỌN siêu thị để test mẫu Tự Đánh Giá (tài khoản admin thường không gắn Vị Trí
    // Siêu Thị cụ thể nào nên isEligibleForStoreSelf() luôn false với admin) — vẫn giữ NGUYÊN bất biến
    // bảo mật cho người dùng thường bên dưới (storeCode LUÔN suy từ user.dept, KHÔNG tin client). Admin
    // vốn đã bỏ qua mọi kiểm tra quyền khác trong toàn hệ thống nên nới ở đây không phát sinh rủi ro mới.
    if (user?.perms?.admin) {
      const adminStoreCode = String(requestedStoreCode || '').trim();
      if (adminStoreCode) return adminStoreCode;
      if (isEligibleForStoreSelf(user)) return user.dept;
      throw new HttpError(400, 'Vui lòng chọn siêu thị để test (tài khoản admin không gắn Vị Trí Siêu Thị cụ thể)');
    }
    if (!isEligibleForStoreSelf(user)) {
      throw new HttpError(400, 'Vị trí hiện tại của bạn không gắn với siêu thị nào — liên hệ HR để kiểm tra Cơ Cấu Tổ Chức (Vị Trí Làm Việc)');
    }
    return user.dept;
  }
  // CONTROL_AUDIT
  const storeCode = String(requestedStoreCode || '').trim();
  if (!storeCode) throw new HttpError(400, 'Vui lòng chọn siêu thị cần đánh giá');
  if (!canAuditStore(user, storeCode)) {
    throw new HttpError(403, 'Bạn không có phạm vi Kiểm Soát cho siêu thị này');
  }
  return storeCode;
}

// ===================== Câu trả lời (lưu nháp) =====================
// Chuẩn hoá answers[] gửi lên khi lưu nháp — KHÔNG chấm điểm ở đây (chỉ finalize mới chấm, xem Mục 6).
// attachments[] KHÔNG nhận trực tiếp ở đây (route riêng /attachments ghi thêm để không phải gửi lại
// toàn bộ ảnh mỗi lần lưu nháp câu trả lời) — giữ nguyên attachments cũ nếu answers gửi lên không kèm.
function sanitizeChecklistAnswers(rawAnswers, template, existingAnswers) {
  const existingByQ = new Map((existingAnswers || []).map(a => [a.questionId, a]));
  const list = Array.isArray(rawAnswers) ? rawAnswers : [];
  const validQuestionIds = new Set((template.questions || []).map(q => q.id));
  return list
    .filter(a => a && validQuestionIds.has(Number(a.questionId)))
    .map(a => {
      const questionId = Number(a.questionId);
      const question = (template.questions || []).find(q => q.id === questionId);
      const validOptionIds = new Set((question?.options || []).map(o => o.id));
      const optionIds = Array.isArray(a.optionIds) ? [...new Set(a.optionIds.map(Number))].filter(id => validOptionIds.has(id)) : [];
      if (question?.type === 'SINGLE_CHOICE' && optionIds.length > 1) optionIds.length = 1;
      return {
        questionId,
        optionIds,
        note: a.note ? String(a.note).trim().slice(0, 500) : '',
        attachments: existingByQ.get(questionId)?.attachments || []
      };
    });
}

// ===================== Mục 5.2/6 tài liệu gốc — câu hỏi đang HIỂN THỊ (điều kiện phân nhánh) =====================
function computeVisibleQuestions(template, answers) {
  const selectedOptionIds = new Set();
  (answers || []).forEach(a => (a.optionIds || []).forEach(id => selectedOptionIds.add(id)));
  return (template.questions || [])
    .filter(q => q.showIfOptionId == null || selectedOptionIds.has(q.showIfOptionId))
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

// ===================== Mục 6 tài liệu gốc — chấm điểm khi Finalize =====================
// Trả về { totalScore, maxPossibleScore, scorePercent, hasCriticalFail, isPassed, missingRequired,
// answersNeedingPhoto } — route gọi hàm này rồi TỰ quyết định throw lỗi (giữ hàm thuần, dễ test).
function computeChecklistScoring(template, answers) {
  const visibleQuestions = computeVisibleQuestions(template, answers);
  const visibleIds = new Set(visibleQuestions.map(q => q.id));
  const answersByQ = new Map((answers || []).map(a => [a.questionId, a]));

  const missingRequired = visibleQuestions.filter(q => q.isRequired && !(answersByQ.get(q.id)?.optionIds || []).length);

  let totalScore = 0, maxPossibleScore = 0, hasCriticalFail = false;
  const answersNeedingPhoto = [];
  for (const q of visibleQuestions) {
    maxPossibleScore += q.maxScore;
    const ans = answersByQ.get(q.id);
    if (!ans) continue;
    const selectedOptions = q.options.filter(o => (ans.optionIds || []).includes(o.id));
    totalScore += selectedOptions.reduce((sum, o) => sum + o.scoreValue, 0);
    // CL-09 (đợt test chuyên sâu 9/2026): isPassing/isCriticalFail là 2 cờ ĐỘC LẬP trên 1 lựa chọn,
    // không có ràng buộc nào ở validateChecklistQuestions() bắt "Lỗi nghiêm trọng" phải kèm "Không đạt"
    // — người tạo mẫu lỡ để cả 2 cờ cùng true (builder mặc định isPassing:true khi thêm lựa chọn mới,
    // xem module-checklist.js) khiến TRƯỚC ĐÂY yêu cầu ảnh chỉ xét !o.isPassing, bỏ lọt đúng trường hợp
    // Lỗi nghiêm trọng nhưng vẫn mang cờ isPassing:true — "Kết Thúc & Nộp" thành công mà không cần ảnh dù
    // đã chọn Lỗi nghiêm trọng. Xét CẢ 2 cờ: cần ảnh nếu KHÔNG đạt HOẶC là lỗi nghiêm trọng.
    const anyFailing = selectedOptions.some(o => !o.isPassing || o.isCriticalFail);
    if (selectedOptions.some(o => o.isCriticalFail)) hasCriticalFail = true;
    if (anyFailing && !(ans.attachments || []).length) answersNeedingPhoto.push(q.id);
  }
  // Câu KHÔNG còn hiển thị (do đổi ý ở câu điều kiện) vẫn giữ lại trong answers[] (audit trail, Mục
  // 5.3) nhưng KHÔNG tính vào điểm — đã tự động loại vì vòng lặp trên chỉ chạy qua visibleQuestions.
  const scorePercent = maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : null;
  const isPassed = hasCriticalFail ? false
    : (template.passThreshold != null && scorePercent != null ? scorePercent >= template.passThreshold : null);

  return { totalScore, maxPossibleScore, scorePercent, hasCriticalFail, isPassed, missingRequired, answersNeedingPhoto, visibleIds: [...visibleIds] };
}

function assertReadyToFinalize(scoring) {
  if (scoring.missingRequired.length) {
    throw new HttpError(400, `Còn ${scoring.missingRequired.length} câu hỏi bắt buộc chưa trả lời`);
  }
  if (scoring.answersNeedingPhoto.length) {
    throw new HttpError(400, 'Vui lòng đính kèm ảnh minh chứng cho tất cả câu trả lời bị đánh giá lỗi trước khi nộp bài');
  }
}

module.exports = {
  TEMPLATE_TYPES, TEMPLATE_STATUSES, QUESTION_TYPES,
  canManageChecklistTemplates, canViewChecklistReports, getChecklistAuditStores, hasChecklistAuditScope,
  canAuditStore, isEligibleForStoreSelf, canAccessChecklistModule,
  validateChecklistQuestions, assertTemplateCoreFields,
  resolveStoreCodeForSubmission, sanitizeChecklistAnswers, computeVisibleQuestions,
  computeChecklistScoring, assertReadyToFinalize,
  nowVN
};
