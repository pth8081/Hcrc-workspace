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
// v20.9 — chế độ chấm điểm cấp TEMPLATE (yêu cầu người dùng: "nếu checklist chỉ kiểm tra đạt hoặc chưa
// đạt thì ẩn chấm điểm đi"). SCORED (mặc định, khớp hành vi mọi template cũ trước v20.9 — field vắng mặt
// trên bản ghi cũ tự coi là SCORED, xem chỗ đọc `template.scoringMode` bên dưới) — chấm điểm/% như cũ.
// PASS_FAIL_ONLY — KHÔNG chấm điểm/%, kết quả Đạt/Không đạt suy từ việc mọi câu trả lời đã chọn có phải
// đáp án "Đạt" hay không (isPassing), độc lập hẳn con số. maxScore/scoreValue vẫn được LƯU (ép về 0 ở
// validateChecklistQuestions() bên dưới — server không tin nguyên payload dù client đã ẩn ô nhập) để giữ
// nguyên hình dạng dữ liệu, tránh phải viết 2 nhánh xử lý khác nhau ở nơi khác.
const SCORING_MODES = new Set(['SCORED', 'PASS_FAIL_ONLY']);
// v21.0 — 2 LOẠI MẪU checklist hoàn toàn khác cấu trúc dữ liệu/cách chấm (yêu cầu người dùng: gửi kèm
// file "Báo cáo Checklist VSATTP" làm mẫu thứ 2, tách riêng với mẫu Câu Hỏi & Đáp Án đang có, chọn loại
// NGAY LÚC TẠO — không đổi được sau khi tạo, xem assertTemplateCoreFields()):
//   - QA (mặc định — mọi template tạo trước v21.0 không có field này tự coi là QA) — mô hình ĐANG CÓ:
//     câu hỏi + nhiều lựa chọn, mỗi lựa chọn tự mang điểm riêng (validateChecklistQuestions() ở trên).
//   - DEDUCTION (mới) — mô hình "trừ điểm theo hạng mục" theo đúng file VSATTP người dùng gửi: cây phân
//     cấp Hạng mục lớn (có điểm tối đa) -> Hạng mục con (điểm tối đa RIÊNG, tuỳ chọn — không đặt thì dùng
//     chung trần của hạng mục lớn) -> nhiều dòng Tiêu chí vi phạm cụ thể (mỗi tiêu chí có "Điểm trừ/1 lần
//     vi phạm" CHỈ mang tính THAM KHẢO hiển thị cho người kiểm tra, không ép buộc — người kiểm tra tự
//     nhập số điểm trừ THỰC TẾ lúc làm bài, vì 1 tiêu chí có thể vi phạm nhiều lần/nhiều vị trí khác
//     nhau trong 1 lượt kiểm tra, xem sanitizeChecklistDeductions()/computeDeductionScoring() bên dưới).
//     KHÔNG có khái niệm "câu bắt buộc"/"ảnh minh chứng bắt buộc"/scoringMode (luôn tính điểm số, không
//     có chế độ chỉ Đạt/Chưa đạt — bản chất mô hình này là ĐO MỨC ĐỘ tuân thủ, không phải nhị phân) —
//     quyết định đã chốt với người dùng qua trao đổi thiết kế.
const TEMPLATE_KINDS = new Set(['QA', 'DEDUCTION']);

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
// scoringMode ('SCORED'/'PASS_FAIL_ONLY', xem SCORING_MODES) — PASS_FAIL_ONLY ép cứng maxScore/scoreValue
// về 0 ở SERVER (bỏ qua hoàn toàn con số client gửi lên, kể cả khi ai đó bỏ qua UI gọi thẳng route) —
// chỉ isPassing/isCriticalFail còn ý nghĩa trong chế độ này.
function validateChecklistQuestions(rawQuestions, scoringMode) {
  const passFailOnly = scoringMode === 'PASS_FAIL_ONLY';
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
    // maxScore — cho phép SỐ ÂM (yêu cầu người dùng: "trừ điểm mỗi câu chưa đáp ứng yêu cầu vàng") ở cấp
    // LỰA CHỌN (scoreValue bên dưới, xem computeChecklistScoring() chặn sàn tổng điểm ở 0 khi cộng dồn)
    // — maxScore CẤP CÂU HỎI vẫn giữ nguyên >=0 (đây là "trần điểm tối đa" của câu, không phải điểm trừ).
    const maxScore = passFailOnly ? 0 : (Number(q?.maxScore) >= 0 ? Number(q.maxScore) : 0);
    const isRequired = q?.isRequired !== false;
    const note = q?.note ? String(q.note).trim().slice(0, 500) : '';
    // category (v21.1) — nhãn NHÓM/HẠNG MỤC tuỳ chọn, THUẦN hiển thị/xuất báo cáo (không ảnh hưởng chấm
    // điểm/hiển thị phân nhánh gì) — cho phép "Xuất Báo Cáo" (lib/checklistReportExport.js) in đúng dòng
    // tiêu đề nhóm + tính % Đạt riêng từng nhóm ở sheet "form thống kê", khớp mẫu Excel người dùng gửi.
    // Để trống = câu hỏi đứng ĐỘC LẬP (không thuộc nhóm nào) — mọi mẫu tạo trước v21.1 không có field này
    // tự hiểu là để trống, không đổi hành vi export (chỉ đơn giản không có dòng tiêu đề nhóm nào cả).
    const category = q?.category ? String(q.category).trim().slice(0, 200) : '';

    const rawOptions = Array.isArray(q?.options) ? q.options : [];
    if (rawOptions.length < 2) throw new HttpError(400, `Câu hỏi số ${i + 1} cần ít nhất 2 lựa chọn`);
    if (rawOptions.length > 10) throw new HttpError(400, `Câu hỏi số ${i + 1} tối đa 10 lựa chọn`);
    const options = rawOptions.map((o, oi) => {
      const oText = String(o?.text || '').trim();
      if (!oText) throw new HttpError(400, `Lựa chọn số ${oi + 1} của câu hỏi số ${i + 1} thiếu nội dung`);
      return {
        id: nextOptionId++,
        text: oText,
        // scoreValue — CHO PHÉP ÂM (VD "-20" cho đáp án "Không đạt" của câu "yêu cầu vàng") để trừ điểm
        // tổng — KHÔNG có ràng buộc >=0 như maxScore, đây chính là cơ chế "trừ điểm" người dùng yêu cầu,
        // không cần field/cờ riêng nào khác (xem trao đổi thiết kế đã chốt).
        scoreValue: passFailOnly ? 0 : (Number.isFinite(Number(o?.scoreValue)) ? Number(o.scoreValue) : 0),
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
      isRequired, maxScore, note, category, options
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

// ===================== Validate Template — LOẠI 2: DEDUCTION ("Trừ điểm theo hạng mục", v21.0)
// =====================
// Cây 3 cấp: Hạng mục lớn (categories) -> Hạng mục con (subItems) -> Tiêu chí vi phạm (criteria). Chỉ
// criteria có "id" (đánh số TOÀN CỤC xuyên suốt cả template, cùng lý do optionId ở validateChecklistQuestions()
// — submission cần 1 con số ổn định để tham chiếu "đợt trừ điểm này ứng với tiêu chí nào", không phụ
// thuộc vị trí trong mảng lồng nhau) — category/subItem chỉ cần id CỤC BỘ (1-based trong phạm vi cha),
// không ai tham chiếu ngược tới chúng nên không cần đánh số toàn cục.
function validateChecklistCategories(rawCategories) {
  const list = Array.isArray(rawCategories) ? rawCategories : [];
  if (!list.length) throw new HttpError(400, 'Checklist cần ít nhất 1 hạng mục đánh giá');
  if (list.length > 50) throw new HttpError(400, 'Checklist tối đa 50 hạng mục đánh giá');

  let nextCriteriaId = 1;
  const categories = list.map((cat, ci) => {
    const name = String(cat?.name || '').trim();
    if (!name) throw new HttpError(400, `Hạng mục số ${ci + 1} thiếu tên`);
    const maxDeduction = Number(cat?.maxDeduction) >= 0 ? Number(cat.maxDeduction) : 0;

    const rawSubItems = Array.isArray(cat?.subItems) ? cat.subItems : [];
    if (!rawSubItems.length) throw new HttpError(400, `Hạng mục "${name}" cần ít nhất 1 hạng mục con`);
    if (rawSubItems.length > 30) throw new HttpError(400, `Hạng mục "${name}" tối đa 30 hạng mục con`);
    const subItems = rawSubItems.map((sub, si) => {
      const subName = String(sub?.name || '').trim();
      if (!subName) throw new HttpError(400, `Hạng mục con số ${si + 1} của "${name}" thiếu tên`);
      // maxDeduction hạng mục con — TUỲ CHỌN (null = dùng chung trần của hạng mục lớn, quyết định đã chốt
      // với người dùng để khớp đúng file gốc: 1 số hạng mục con để trống, dùng chung trần cha).
      const subMaxRaw = sub?.maxDeduction;
      const maxDeductionOwn = (subMaxRaw === '' || subMaxRaw === null || subMaxRaw === undefined)
        ? null : (Number(subMaxRaw) >= 0 ? Number(subMaxRaw) : 0);

      const rawCriteria = Array.isArray(sub?.criteria) ? sub.criteria : [];
      if (!rawCriteria.length) throw new HttpError(400, `Hạng mục con "${subName}" cần ít nhất 1 tiêu chí đánh giá`);
      if (rawCriteria.length > 50) throw new HttpError(400, `Hạng mục con "${subName}" tối đa 50 tiêu chí`);
      const criteria = rawCriteria.map((c, cri) => {
        const description = String(c?.description || '').trim();
        if (!description) throw new HttpError(400, `Tiêu chí số ${cri + 1} của "${subName}" thiếu mô tả`);
        return {
          id: nextCriteriaId++,
          description: description.slice(0, 1000),
          // ruleText — mô tả quy tắc trừ điểm (VD "Cho 1 mã SP không phù hợp"), THUẦN THÔNG TIN cho người
          // kiểm tra đọc, KHÔNG được server dùng để tính toán gì (xem lý do perInstanceValue bên dưới).
          ruleText: c?.ruleText ? String(c.ruleText).trim().slice(0, 300) : '',
          // perInstanceValue — điểm trừ THAM KHẢO cho 1 lần vi phạm (VD 2đ/mã SP không phù hợp), CHỈ hiển
          // thị gợi ý cho người kiểm tra lúc làm bài — KHÔNG ép buộc/tính tự động, vì 1 tiêu chí có thể vi
          // phạm ở NHIỀU vị trí/mã SP khác nhau trong 1 lượt kiểm tra (VD "3 mã SP không phù hợp" = người
          // kiểm tra tự nhân perInstanceValue × 3 rồi nhập THẲNG tổng điểm trừ thực tế, xem
          // sanitizeChecklistDeductions()) — khớp đúng cách file Excel gốc vận hành.
          perInstanceValue: Number.isFinite(Number(c?.perInstanceValue)) && Number(c.perInstanceValue) >= 0 ? Number(c.perInstanceValue) : 0,
          displayOrder: cri + 1
        };
      });
      return { id: si + 1, name: subName, maxDeduction: maxDeductionOwn, criteria, displayOrder: si + 1 };
    });
    return { id: ci + 1, name, maxDeduction, subItems, displayOrder: ci + 1 };
  });
  return categories;
}

function assertTemplateCoreFields(payload) {
  const templateCode = String(payload?.templateCode || '').trim();
  const templateName = String(payload?.templateName || '').trim();
  if (!templateCode) throw new HttpError(400, 'Thiếu mã checklist (templateCode)');
  if (!templateName) throw new HttpError(400, 'Thiếu tên checklist');
  if (!TEMPLATE_TYPES.has(payload?.templateType)) throw new HttpError(400, 'Loại checklist không hợp lệ (STORE_SELF/CONTROL_AUDIT)');
  // templateKind — mặc định QA nếu payload không gửi/gửi giá trị lạ (khớp hành vi mọi template tạo trước
  // v21.0, vốn không có field này) — BẤT BIẾN sau khi tạo (route /templates/:id/edit tự đối chiếu lại
  // với bản ghi gốc, xem routes/checklist.js — không cho đổi loại mẫu giữa chừng).
  const templateKind = TEMPLATE_KINDS.has(payload?.templateKind) ? payload.templateKind : 'QA';
  // scoringMode — CHỈ áp dụng cho templateKind QA (DEDUCTION luôn tính điểm số, không có khái niệm "chỉ
  // Đạt/Chưa đạt" — bản chất là đo MỨC ĐỘ tuân thủ, xem chú thích TEMPLATE_KINDS) — ép về null cho
  // DEDUCTION để không lưu field vô nghĩa. Mặc định SCORED nếu payload không gửi/gửi giá trị lạ (khớp
  // hành vi mọi template tạo trước v20.9). PASS_FAIL_ONLY ép cứng passThreshold về null NGAY Ở ĐÂY (không
  // còn ý nghĩa "ngưỡng đạt theo %" khi không chấm điểm/% nữa) — bất kể client gửi gì.
  const scoringMode = templateKind === 'DEDUCTION' ? null : (SCORING_MODES.has(payload?.scoringMode) ? payload.scoringMode : 'SCORED');
  const passThreshold = scoringMode === 'PASS_FAIL_ONLY' || payload?.passThreshold === null || payload?.passThreshold === undefined || payload?.passThreshold === ''
    ? null : Number(payload.passThreshold);
  if (passThreshold !== null && (!Number.isFinite(passThreshold) || passThreshold < 0 || passThreshold > 100)) {
    throw new HttpError(400, 'Ngưỡng điểm đạt (%) không hợp lệ');
  }
  return { templateCode: templateCode.slice(0, 50), templateName: templateName.slice(0, 200), templateType: payload.templateType, templateKind, scoringMode, passThreshold };
}

// ===================== Mục 7.1 tài liệu gốc — điểm bảo mật cốt lõi =====================
// Xác định storeCode khi BẮT ĐẦU 1 submission — logic PHẢI nằm ở server, không tin bất kỳ giá trị nào
// client tự gửi cho STORE_SELF (mới đúng tinh thần "TUYỆT ĐỐI không dùng requestedStoreCode từ client"
// của tài liệu gốc).
//
// validStoreCodes: mảng TÊN siêu thị thật lấy từ DB.stores (Danh Mục Siêu Thị, xem lib/appData.js
// getAppDataValueCached('stores') ở nơi gọi) — LỖI ĐÃ VÁ (rà soát chuyên sâu 2, cụm "Hành Chính", mức
// Trung bình): TRƯỚC ĐÂY hàm này không đối chiếu storeCode với danh mục thật ở BẤT KỲ nhánh nào (kể cả
// nhánh scope.all/admin — canAuditStore() chỉ kiểm tra PHẠM VI quyền, không kiểm tra CHUỖI đó có tồn tại
// trong danh mục hay không), nên 1 request tự soạn với `checklistAuditScope: {all:true}` (hoặc tài khoản
// admin) gửi BẤT KỲ chuỗi nào làm storeCode vẫn tạo được submission — hồ sơ mang tên siêu thị không có
// thật, gây nhiễu báo cáo/thống kê. Đối chiếu THẬT ở MỌI nhánh (kể cả admin/scope.all) trước khi trả về.
function resolveStoreCodeForSubmission(template, user, requestedStoreCode, validStoreCodes) {
  const knownStores = new Set(Array.isArray(validStoreCodes) ? validStoreCodes : []);
  const assertKnownStore = (code) => {
    if (!knownStores.has(code)) {
      throw new HttpError(400, `Siêu thị "${code}" không có trong Danh Mục Siêu Thị — vui lòng chọn lại`);
    }
  };
  if (template.templateType === 'STORE_SELF') {
    // Admin: cho phép TỰ CHỌN siêu thị để test mẫu Tự Đánh Giá (tài khoản admin thường không gắn Vị Trí
    // Siêu Thị cụ thể nào nên isEligibleForStoreSelf() luôn false với admin) — vẫn giữ NGUYÊN bất biến
    // bảo mật cho người dùng thường bên dưới (storeCode LUÔN suy từ user.dept, KHÔNG tin client). Admin
    // vốn đã bỏ qua mọi kiểm tra quyền khác trong toàn hệ thống nên nới ở đây không phát sinh rủi ro mới
    // — nhưng vẫn phải là 1 siêu thị CÓ THẬT trong danh mục (không phải bất kỳ chuỗi nào).
    if (user?.perms?.admin) {
      const adminStoreCode = String(requestedStoreCode || '').trim();
      if (adminStoreCode) { assertKnownStore(adminStoreCode); return adminStoreCode; }
      if (isEligibleForStoreSelf(user)) return user.dept;
      throw new HttpError(400, 'Vui lòng chọn siêu thị để test (tài khoản admin không gắn Vị Trí Siêu Thị cụ thể)');
    }
    if (!isEligibleForStoreSelf(user)) {
      throw new HttpError(400, 'Vị trí hiện tại của bạn không gắn với siêu thị nào — liên hệ HR để kiểm tra Cơ Cấu Tổ Chức (Vị Trí Làm Việc)');
    }
    // user.dept của người dùng THẬT (không phải admin test) luôn tin được — không đối chiếu lại danh mục
    // ở đây (đúng khuôn mọi nơi khác trong hệ thống tin user.dept đã gắn qua Cơ Cấu Tổ Chức).
    return user.dept;
  }
  // CONTROL_AUDIT
  const storeCode = String(requestedStoreCode || '').trim();
  if (!storeCode) throw new HttpError(400, 'Vui lòng chọn siêu thị cần đánh giá');
  if (!canAuditStore(user, storeCode)) {
    throw new HttpError(403, 'Bạn không có phạm vi Kiểm Soát cho siêu thị này');
  }
  assertKnownStore(storeCode);
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

// ===================== Điểm trừ (lưu nháp) — LOẠI 2: DEDUCTION (v21.0) =====================
// Chuẩn hoá deductions[] gửi lên khi lưu nháp — KHÔNG chấm điểm ở đây (chỉ finalize mới chấm, mirror
// đúng sanitizeChecklistAnswers() ở trên). attachments[] KHÔNG bắt buộc (khác QA — mẫu VSATTP gốc không
// có cột ảnh minh chứng, quyết định đã chốt: ảnh ở đây là TUỲ CHỌN).
function sanitizeChecklistDeductions(rawDeductions, template, existingDeductions) {
  const existingByC = new Map((existingDeductions || []).map(d => [d.criteriaId, d]));
  const list = Array.isArray(rawDeductions) ? rawDeductions : [];
  const validCriteria = new Map();
  (template.categories || []).forEach(cat => (cat.subItems || []).forEach(sub => (sub.criteria || []).forEach(c => validCriteria.set(c.id, cat))));
  return list
    .filter(d => d && validCriteria.has(Number(d.criteriaId)))
    .map(d => {
      const criteriaId = Number(d.criteriaId);
      const cat = validCriteria.get(criteriaId);
      // Không cho trừ nhiều hơn trần của CẢ hạng mục lớn từ 1 dòng duy nhất — chặn nhập liệu vô lý (VD gõ
      // nhầm thừa số 0), KHÔNG phải luật nghiệp vụ thật (trần thật áp dụng lúc CỘNG DỒN, xem
      // computeDeductionScoring() bên dưới).
      const rawPoints = Number(d.deductedPoints);
      const deductedPoints = Number.isFinite(rawPoints) && rawPoints > 0 ? Math.min(rawPoints, cat.maxDeduction || rawPoints) : 0;
      return {
        criteriaId,
        deductedPoints,
        description: d.description ? String(d.description).trim().slice(0, 1000) : '',
        riskLevel: ['A', 'B', 'C'].includes(d.riskLevel) ? d.riskLevel : null,
        deadline: d.deadline ? String(d.deadline).trim().slice(0, 20) : '',
        note: d.note ? String(d.note).trim().slice(0, 500) : '',
        attachments: existingByC.get(criteriaId)?.attachments || []
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
  // Template CŨ (trước v20.9) không có field scoringMode -> mặc định SCORED (tương thích ngược).
  const scoringMode = SCORING_MODES.has(template?.scoringMode) ? template.scoringMode : 'SCORED';
  const visibleQuestions = computeVisibleQuestions(template, answers);
  const visibleIds = new Set(visibleQuestions.map(q => q.id));
  const answersByQ = new Map((answers || []).map(a => [a.questionId, a]));

  const missingRequired = visibleQuestions.filter(q => q.isRequired && !(answersByQ.get(q.id)?.optionIds || []).length);

  let totalScore = 0, maxPossibleScore = 0, hasCriticalFail = false, hasFailingAnswer = false;
  const answersNeedingPhoto = [];
  for (const q of visibleQuestions) {
    maxPossibleScore += q.maxScore;
    const ans = answersByQ.get(q.id);
    if (!ans) continue;
    const selectedOptions = q.options.filter(o => (ans.optionIds || []).includes(o.id));
    // LỖI ĐÃ VÁ (rà soát chuyên sâu 2, cụm "Hành Chính", mức Trung bình): câu MULTIPLE_CHOICE cộng dồn
    // scoreValue của TẤT CẢ lựa chọn đã chọn — trước đây không hề bị chặn trần q.maxScore của CHÍNH câu
    // đó (chỉ có sàn 0 ở CUỐI hàm cho TOÀN BỘ bài, xem `totalScore = Math.max(0, totalScore)` bên dưới),
    // nên 1 câu có nhiều lựa chọn cùng mang điểm dương (VD 3 lựa chọn value=10, maxScore=10) chọn hết cả
    // 3 sẽ cộng ra 30 dù bản thân câu đó chỉ đáng tối đa 10 -> scorePercent có thể vượt hẳn 100% (SINGLE_
    // CHOICE không bị lỗi này vì sanitizeChecklistAnswers() ở trên đã ép optionIds.length=1). Chặn trần
    // NGAY TẠI ĐÂY (Math.min theo đúng q.maxScore của câu, không đụng tới sàn 0 patchĐã có) để không câu
    // nào vượt quá điểm tối đa của chính nó, dù vẫn cho phép sàn ÂM đi qua (1 số lựa chọn scoreValue âm
    // dùng để trừ điểm "yêu cầu vàng" — chỉ chặn TRẦN, không chặn sàn ở đây).
    const rawQuestionScore = selectedOptions.reduce((sum, o) => sum + o.scoreValue, 0);
    totalScore += q.type === 'MULTIPLE_CHOICE' ? Math.min(rawQuestionScore, q.maxScore) : rawQuestionScore;
    // CL-09 (đợt test chuyên sâu 9/2026): isPassing/isCriticalFail là 2 cờ ĐỘC LẬP trên 1 lựa chọn,
    // không có ràng buộc nào ở validateChecklistQuestions() bắt "Lỗi nghiêm trọng" phải kèm "Không đạt"
    // — người tạo mẫu lỡ để cả 2 cờ cùng true (builder mặc định isPassing:true khi thêm lựa chọn mới,
    // xem module-checklist.js) khiến TRƯỚC ĐÂY yêu cầu ảnh chỉ xét !o.isPassing, bỏ lọt đúng trường hợp
    // Lỗi nghiêm trọng nhưng vẫn mang cờ isPassing:true — "Kết Thúc & Nộp" thành công mà không cần ảnh dù
    // đã chọn Lỗi nghiêm trọng. Xét CẢ 2 cờ: cần ảnh nếu KHÔNG đạt HOẶC là lỗi nghiêm trọng.
    const anyFailing = selectedOptions.some(o => !o.isPassing || o.isCriticalFail);
    if (anyFailing) hasFailingAnswer = true;
    if (selectedOptions.some(o => o.isCriticalFail)) hasCriticalFail = true;
    if (anyFailing && !(ans.attachments || []).length) answersNeedingPhoto.push(q.id);
  }
  // Câu KHÔNG còn hiển thị (do đổi ý ở câu điều kiện) vẫn giữ lại trong answers[] (audit trail, Mục
  // 5.3) nhưng KHÔNG tính vào điểm — đã tự động loại vì vòng lặp trên chỉ chạy qua visibleQuestions.

  // PASS_FAIL_ONLY (v20.9) — KHÔNG có khái niệm điểm/% (kể cả để lưu ngầm), "Đạt" suy TRỰC TIẾP từ việc
  // mọi câu trả lời đã chọn đều là đáp án "Đạt" (không phụ thuộc con số nào) — độc lập hẳn với nhánh
  // SCORED bên dưới, đúng yêu cầu "ẩn chấm điểm đi" (không chỉ ẩn ở UI mà server cũng không tính ra).
  if (scoringMode === 'PASS_FAIL_ONLY') {
    const isPassed = hasCriticalFail ? false : !hasFailingAnswer;
    return { totalScore: null, maxPossibleScore: null, scorePercent: null, hasCriticalFail, isPassed, missingRequired, answersNeedingPhoto, visibleIds: [...visibleIds] };
  }

  // SCORED — yêu cầu người dùng: cho phép trừ điểm (scoreValue âm, xem validateChecklistQuestions()) khi
  // 1 câu "yêu cầu vàng" không đạt, nhưng CHẶN SÀN tổng điểm/% ở 0 (không hiển thị số âm) — quyết định đã
  // chốt qua trao đổi thiết kế, KHÔNG lộ ra 1 checklist bị trừ "quá tay" xuống âm sâu gây khó đọc báo cáo.
  totalScore = Math.max(0, totalScore);
  const scorePercent = maxPossibleScore > 0 ? Math.max(0, (totalScore / maxPossibleScore) * 100) : null;
  const isPassed = hasCriticalFail ? false
    : (template.passThreshold != null && scorePercent != null ? scorePercent >= template.passThreshold : null);

  return { totalScore, maxPossibleScore, scorePercent, hasCriticalFail, isPassed, missingRequired, answersNeedingPhoto, visibleIds: [...visibleIds] };
}

// ===================== Chấm điểm khi Finalize — LOẠI 2: DEDUCTION (v21.0) =====================
// Điểm hạng mục lớn = max(0, trần hạng mục lớn − TỔNG điểm trừ đã dùng của mọi hạng mục con của nó) —
// mirror ĐÚNG công thức Excel gốc (VD "=IF(SUM(G14:G17)>10,0,D14-SUM(G14:G17))"), áp dụng Ở CẤP HẠNG MỤC
// LỚN (không phải cộng dồn "điểm còn lại" tính riêng của TỪNG hạng mục con — xem LỖI ĐÃ VÁ bên dưới).
// Điểm trừ đã dùng của 1 hạng mục con:
//   - CÓ đặt trần riêng (sub.maxDeduction != null): min(tổng điểm trừ các tiêu chí của nó, trần riêng đó)
//     — hạng mục con này KHÔNG thể "ăn lẹm" quá trần riêng vào phần chung của hạng mục lớn.
//   - KHÔNG đặt trần riêng (null): TOÀN BỘ tổng điểm trừ các tiêu chí của nó, KHÔNG quy đổi/quy tròn qua
//     bất kỳ trần nào riêng — khớp cách file gốc để trống cột "Điểm trừ tối đa" ở 1 số hạng mục con (VD
//     "1.2 Hạn sử dụng": dùng CHUNG trần của hạng mục lớn với các hạng mục con khác cũng để trống, không
//     phải mỗi hạng mục con được cấp NGUYÊN VẸN 1 bản sao trần của hạng mục lớn).
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu 2, cụm "Hành Chính", mức Cao — "NUỐT TRỌN điểm trừ"): code CŨ tính điểm
// CÒN LẠI riêng cho TỪNG hạng mục con (`effectiveMax − subDeducted`, hạng mục con không có trần riêng
// dùng effectiveMax = TRỌN VẸN trần hạng mục lớn) rồi CỘNG DỒN các điểm còn lại đó, cuối cùng mới
// Math.min ở cấp hạng mục lớn. Hậu quả: 1 hạng mục con KHÔNG bị trừ điểm vẫn đóng góp NGUYÊN VẸN trần
// hạng mục lớn vào tổng, "nuốt trọn" phần điểm trừ đã nhập ở (các) hạng mục con khác — VD trần lớn 10, 2
// hạng mục con không trần riêng, 1 hạng mục con bị trừ 10 (còn lại 0) + hạng mục con kia không bị trừ gì
// (còn lại 10) → tổng cộng dồn = 10 → Math.min(10,10) = 10 = 100%, dù đã trừ tối đa. Sửa: cộng dồn TRỰC
// TIẾP điểm TRỪ đã dùng (không phải điểm còn lại) của mọi hạng mục con trong CÙNG 1 hạng mục lớn trước,
// rồi mới trừ 1 LẦN DUY NHẤT ra khỏi trần hạng mục lớn — không hạng mục con nào còn "chiếm giữ" riêng 1
// phần trần độc lập của hạng mục lớn nữa.
function computeDeductionScoring(template, deductions) {
  const deductionsByC = new Map((deductions || []).map(d => [d.criteriaId, d]));
  let totalScore = 0, maxPossibleScore = 0;
  for (const cat of (template.categories || [])) {
    maxPossibleScore += cat.maxDeduction;
    let categoryDeductionUsed = 0;
    for (const sub of (cat.subItems || [])) {
      const subDeducted = (sub.criteria || []).reduce((sum, c) => sum + (deductionsByC.get(c.id)?.deductedPoints || 0), 0);
      categoryDeductionUsed += sub.maxDeduction != null ? Math.min(subDeducted, sub.maxDeduction) : subDeducted;
    }
    totalScore += Math.max(0, cat.maxDeduction - categoryDeductionUsed);
  }
  const scorePercent = maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : null;
  const isPassed = template.passThreshold != null && scorePercent != null ? scorePercent >= template.passThreshold : null;

  return {
    totalScore, maxPossibleScore, scorePercent, hasCriticalFail: false, isPassed,
    missingRequired: [], answersNeedingPhoto: []
  };
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
  TEMPLATE_TYPES, TEMPLATE_STATUSES, QUESTION_TYPES, SCORING_MODES, TEMPLATE_KINDS,
  canManageChecklistTemplates, canViewChecklistReports, getChecklistAuditStores, hasChecklistAuditScope,
  canAuditStore, isEligibleForStoreSelf, canAccessChecklistModule,
  validateChecklistQuestions, validateChecklistCategories, assertTemplateCoreFields,
  resolveStoreCodeForSubmission, sanitizeChecklistAnswers, sanitizeChecklistDeductions, computeVisibleQuestions,
  computeChecklistScoring, computeDeductionScoring, assertReadyToFinalize,
  nowVN
};
