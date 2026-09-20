// lib/workflowEngine.js — Bản sao phía SERVER của logic phê duyệt theo bước đang chạy ở JS trình
// duyệt (index.html). Trước đây "duyệt hồ sơ" chỉ là client tự tính toán rồi POST nguyên collection
// lên ghi đè — server không hề kiểm tra người gọi có đúng là approver ở đúng bước hay không, ai có
// phiên đăng nhập hợp lệ (bất kỳ nhân viên nào) cũng gọi thẳng API để tự duyệt hồ sơ của mình được.
// Đây là gốc chính của Bước 1 (phương án C): server tự xác minh lại đúng bước quy trình trước khi
// chấp nhận ghi.
//
// LƯU Ý BẢO TRÌ: các hàm normalizeApproversList/getStepApprovedUsernames/canApproveStep/
// isStepApprovalComplete PHẢI giữ giống hệt logic cùng tên trong index.html — sửa 1 bên phải sửa cả
// 2 bên, vì đây là 2 cài đặt độc lập (không import chung được do index.html chạy trong trình duyệt).

// ===== Sao y nguyên từ index.html (không phụ thuộc DOM, port thẳng được) =====
function normalizeApproversList(stepApprovers) {
  if (Array.isArray(stepApprovers)) return stepApprovers;
  if (stepApprovers) return [stepApprovers];
  return [];
}

function getStepApprovedUsernames(history, step) {
  return new Set((history || []).filter(h => h.step === step && h.action === 'APPROVED' && !h.invalidated).map(h => h.username));
}

function canApproveStep(user, stepApprovers, history, step) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  const approversList = normalizeApproversList(stepApprovers);
  if (!approversList.includes(user.username)) return false;
  return !getStepApprovedUsernames(history, step).has(user.username);
}

function isStepApprovalComplete(user, stepApprovers, history, step) {
  if (user?.perms?.admin) return true;
  const approversList = normalizeApproversList(stepApprovers);
  if (approversList.length === 0) return true;
  const approved = getStepApprovedUsernames(history, step);
  return approversList.every(u => approved.has(u));
}

// Đăng Ký Xe không có hàm kiểm tra trùng lịch tương đương findMeetingConflict() (Phòng Họp) — biển số
// xe chỉ được Phòng Hành Chính GÁN lúc DUYỆT (extraFields.assignedPlate, không phải lúc tạo phiếu như
// phòng họp), nên kiểm tra trùng phải chạy ngay tại đây, ngay trước khi ghi assignedPlate. existingCar
// Regs do CALLER (routes/workflow.js) tự đọc collection carRegs truyền vào (chỉ carRegs cần).
function findCarPlateConflict(existingCarRegs, itemId, plate, startTime, endTime) {
  if (!plate) return null;
  const newStart = new Date(startTime).getTime();
  const newEnd = new Date(endTime).getTime();
  if (!Number.isFinite(newStart) || !Number.isFinite(newEnd)) return null;
  return (existingCarRegs || []).find(c => {
    if (c.id === itemId || c.assignedPlate !== plate) return false;
    if (c.status === 'REJECTED' || c.status === 'CANCELLED') return false;
    const cStart = new Date(c.startTime).getTime();
    const cEnd = new Date(c.endTime).getTime();
    // Bản ghi lỗi định dạng (NaN) coi là CÓ trùng (an toàn hơn: chặn gán trùng biển số cho tới khi bản
    // ghi lỗi được xử lý) thay vì bỏ qua như trước — khớp đúng lý luận findMeetingConflict() ở
    // lib/createValidation.js (trước đây 2 hàm xử lý bất đối xứng: Phòng Họp coi NaN là "có trùng" còn
    // Xe coi NaN là "không trùng" — audit Đợt 5, Giai đoạn 4. Chưa từng khai thác được vì mọi đường ghi
    // hiện tại đã validate ngày hợp lệ trước khi tới đây, nhưng đáng đồng bộ lại cho nhất quán/an toàn.
    if (!Number.isFinite(cStart) || !Number.isFinite(cEnd)) return true;
    return newStart < cEnd && cStart < newEnd;
  });
}

// LỖI THẬT phát hiện đợt rà soát chuyên sâu (10/2026): chỉ có findCarPlateConflict() (kiểm tra trùng
// BIỂN SỐ) — hoàn toàn KHÔNG kiểm tra trùng TÀI XẾ. Người Điều Hành Xe duyệt phiếu A (08:00-10:00, xe 1,
// gán tài xế "nva") rồi duyệt phiếu B (09:00-11:00, xe 2 KHÁC, cũng gán tài xế "nva") — 2 biển số khác
// nhau nên findCarPlateConflict() không phát hiện gì, cả 2 phiếu đều được duyệt bình thường (chỉ cần 2
// thao tác tuần tự qua UI, KHÔNG cần race condition) — 1 tài xế bị phân công lái 2 xe cùng lúc, chỉ lộ
// ra khi tài xế/người đăng ký phát hiện thủ công. Mirror y hệt findCarPlateConflict() (cùng quy ước bỏ
// qua REJECTED/CANCELLED, coi ngày lỗi định dạng là CÓ trùng), chỉ đổi field so khớp.
function findCarDriverConflict(existingCarRegs, itemId, driverUsername, startTime, endTime) {
  if (!driverUsername) return null;
  const newStart = new Date(startTime).getTime();
  const newEnd = new Date(endTime).getTime();
  if (!Number.isFinite(newStart) || !Number.isFinite(newEnd)) return null;
  return (existingCarRegs || []).find(c => {
    if (c.id === itemId || c.assignedDriverUsername !== driverUsername) return false;
    if (c.status === 'REJECTED' || c.status === 'CANCELLED') return false;
    const cStart = new Date(c.startTime).getTime();
    const cEnd = new Date(c.endTime).getTime();
    if (!Number.isFinite(cStart) || !Number.isFinite(cEnd)) return true;
    return newStart < cEnd && cStart < newEnd;
  });
}

// ===== Văn Bản Trình: quy trình theo loại + lớp phê duyệt bổ sung (khớp index.html) =====
const SUBMISSION_TYPES = [
  { key: 'CHU_TRUONG', label: 'Tờ trình xin chủ trương' },
  { key: 'KINH_PHI', label: 'Tờ trình duyệt kinh phí' },
  { key: 'NHAN_SU', label: 'Tờ trình nhân sự / bổ nhiệm' },
  { key: 'QUY_CHE', label: 'Tờ trình ban hành Quy chế / Quy định' },
  { key: 'KHAC', label: 'Tờ trình khác' }
];

function getSubmissionDeptWorkflowConfig(type, dept, appData) {
  const typeEntry = SUBMISSION_TYPES.find(t => t.label === type);
  const typeKey = typeEntry ? typeEntry.key : 'KHAC';
  const typeMap = appData.submissionTypeDeptWorkflows?.[typeKey];
  const fromType = typeMap ? typeMap[dept] : null;
  if (fromType) return fromType;
  return appData.submissionDeptWorkflows?.[dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
}

function resolveSubmissionWorkflow(sub, appData) {
  if (sub.effectiveSteps && sub.effectiveApprovers) {
    return { steps: sub.effectiveSteps, approvers: sub.effectiveApprovers };
  }
  const baseConfig = getSubmissionDeptWorkflowConfig(sub.type, sub.dept, appData);
  const baseWf = (appData.workflows || []).find(w => w.id === baseConfig.workflowId) || { steps: [{ order: 1, name: 'Sếp duyệt' }] };
  const steps = baseWf.steps.map(s => ({ order: s.order, name: s.name }));
  const approvers = {};
  baseWf.steps.forEach(s => { approvers[s.order] = resolveStepApproverUsernames(baseConfig, s.order, appData.users); });
  return { steps, approvers };
}

// resolveStepApproverUsernames() (lib/positionApprovers.js) — ĐIỂM TRA CỨU DUY NHẤT cho approvers[stepOrder]
// của 1 bước, xử lý cả bước "Theo vị trí" (approverMode[stepOrder]==='POSITION', tính ĐỘNG từ
// approversByPosition[stepOrder] + DB.users hiện tại) lẫn bước PEOPLE thường (đọc thẳng
// approvers[stepOrder], hành vi CŨ 100%). Tách file riêng (không định nghĩa thẳng ở đây) vì
// lib/createValidation.js (2 module snapshot lúc tạo — Văn Bản Trình/Phê Duyệt HĐ) cũng cần gọi hàm
// NÀY, mà file này (workflowEngine.js) đã require('./createValidation') sẵn — require ngược lại sẽ tạo
// vòng lặp, xem chú thích đầu file lib/positionApprovers.js.
const { resolveStepApproverUsernames } = require('./positionApprovers');

// Quy đổi { workflowId, approvers } (Doc/CarReg/Office, tra cứu qua DB.workflows) sang cùng dạng
// { steps, approvers } phẳng mà Submission đã dùng sẵn — để phần xử lý chuyển bước dùng chung 1 mã.
// approvers[s.order] giờ tra qua resolveStepApproverUsernames() (KHÔNG đọc thẳng wfConfig.approvers[s.order]
// nữa) — đây là điểm TRUNG TÂM DUY NHẤT mọi module (trừ 2 module snapshot ở lib/createValidation.js) đi
// qua trước khi tới canApproveStep(), nên bước "Theo vị trí" tự động có hiệu lực ở TẤT CẢ các module gọi
// hàm này (docs/carRegs/officeReqs/vppRegistrations/contractsSignedFile/itPriceApprovals(RETAIL+WHOLESALE)/
// budgetEntries/operationOrders(STORE+HO)) mà KHÔNG cần sửa riêng từng module.
function flatWorkflowConfigToSteps(wfConfig, appData) {
  const wf = (appData.workflows || []).find(w => w.id === wfConfig?.workflowId) || { steps: [{ order: 1, name: 'Duyệt' }] };
  const approvers = {};
  wf.steps.forEach(s => { approvers[s.order] = resolveStepApproverUsernames(wfConfig, s.order, appData.users); });
  return { steps: wf.steps, approvers };
}

// ===== Hỗ Trợ IT — Phê Duyệt Giá: cấu hình duyệt theo phòng ban × LOẠI GIÁ (RETAIL/WHOLESALE) =====
// itPriceDeptWorkflows đổi cấu trúc từ { [dept]: {workflowId,approvers} } (CŨ, phẳng — 1 cấu hình
// chung cho mọi loại giá) sang lồng thêm 1 cấp loại giá: { [dept]: { RETAIL: {...}, WHOLESALE: {...} } }
// (xem defaults.js). CHỈ dùng cho ĐÚNG module itPriceApprovals — resolveWfConfig() của các module khác
// trong MODULE_CONFIGS bên dưới KHÔNG đụng tới hàm này.
//
// Tương thích ngược BẮT BUỘC (2 tầng, xem thêm item.priceType ở createValidation.js): cấu hình phòng
// ban CŨ (phẳng, có workflowId trực tiếp, KHÔNG có nhánh RETAIL/WHOLESALE lồng bên trong) coi TOÀN BỘ
// là cấu hình cho RETAIL — đúng tinh thần "dữ liệu hiện tại chuyển hết vào Bán Lẻ". WHOLESALE của
// phòng ban đó coi như CHƯA cấu hình (trả null — flatWorkflowConfigToSteps() bên dưới tự rơi về mặc
// định {WF_1STEP, approvers rỗng} như mọi module khác chưa cấu hình gì, KHÔNG throw). Không cần script
// migrate dữ liệu DB — xử lý hoàn toàn bằng fallback đọc lúc runtime. PHẢI giữ giống hệt bản mirror
// client resolveItPriceDeptWorkflowConfigClient() ở public/index.html.
function resolveItPriceDeptWorkflowConfig(itPriceDeptWorkflows, dept, priceType) {
  const cfg = (itPriceDeptWorkflows || {})[dept];
  if (!cfg) return null;
  const type = priceType === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL';
  // Cấu trúc MỚI: có nhánh RETAIL và/hoặc WHOLESALE lồng bên trong (kể cả khi chỉ mới có 1 trong 2).
  if (cfg.RETAIL || cfg.WHOLESALE) return cfg[type] || null;
  // Cấu trúc CŨ (phẳng) — chỉ có ý nghĩa cho RETAIL.
  return type === 'RETAIL' ? cfg : null;
}

// Bán Buôn (WHOLESALE) — KHÔNG còn theo phòng ban, đổi sang theo 1 trong 4 mức Margin/Chiết Khấu cố
// định (đã chốt với người dùng: danh sách PHẲNG, không lồng nhau). Map phẳng đơn giản {tierKey:
// {workflowId, approvers}}, không cần fallback tương thích ngược (cấu hình hoàn toàn mới, không kế
// thừa dữ liệu cũ nào).
function resolveItPriceTierWorkflowConfig(itPriceTierWorkflows, priceTier) {
  return (itPriceTierWorkflows || {})[priceTier] || null;
}

// Đầu Tư (DAU_TU) đã bị xoá hoàn toàn khỏi module Tổng Hợp — xem lib/createValidation.js
// OFFICE_SUBTYPE_TO_PERM_FLAG (đã bỏ DAU_TU ở đó nên không còn tạo mới được nữa).
const OFFICE_SUBTYPE_TO_DBKEY = {
  MUA_BAN: 'officeBuyDeptWorkflows',
  SUA_CHUA: 'officeFixDeptWorkflows'
};

// ===== Vận Hành > Đơn Hàng — tách "Đặt Hàng Tại Siêu Thị"/"Đặt Hàng Tại HO" (item.orderLocationType,
// STORE/HO) + đổi hẳn từ quy trình duyệt THEO PHÒNG BAN (operationOrderDeptWorkflows, đã bị xoá — xem
// lịch sử ở CHANGELOG/VERSION.md "Tách Đơn Hàng Siêu Thị/HO") sang quy trình duyệt THEO MỨC GIÁ TRỊ đơn
// hàng (tier), 2 quy trình HOÀN TOÀN ĐỘC LẬP nhau — cùng tinh thần resolveItPriceTierWorkflowConfig() ở
// trên (Hỗ Trợ IT > Bán Buôn) nhưng khác 1 điểm quan trọng: mức Margin/Chiết Khấu ở ITPRICE phải người
// đề xuất TỰ CHỌN (không suy ra được từ field nào khác), còn ở đây mức giá trị SUY RA ĐƯỢC trực tiếp từ
// chính số tiền đơn hàng — nên KHÔNG có field priceTier-tương-đương nào client tự chọn/gửi lên, tier
// luôn được SERVER TỰ TÍNH LẠI ngay tại đây mỗi lần cần tra quy trình (không lưu thành field riêng trên
// item — tính trực tiếp từ orderLocationType + amount/paymentTotalAmount ĐANG CÓ trên item, đảm bảo luôn
// khớp đúng dữ liệu hiện tại của hồ sơ, kể cả sau khi "Sửa & Gửi Lại" đổi lại amount).
//
// Biên giới mức — đợt 1 (Siêu Thị đổi lại theo yêu cầu người dùng "3 mức <=10tr/>10-100tr/>100tr", SAU
// khi đã tách STORE/HO + vá lỗ hổng paymentTotalAmount ở computeOperationOrderAmount() bên trên): mốc
// đúng bằng rơi vào mức THẤP HƠN (khớp chữ "≤" người dùng dùng), NGƯỢC với quy ước "<" cũ (mốc đúng bằng
// từng rơi vào mức CAO hơn) — dùng field maxInclusive (thay vì maxExclusive) + so sánh "<=" trong
// computeOperationOrderTier() bên dưới. Lúc đó CHỈ đổi cho STORE, HO tạm giữ nguyên quy ước "<"/
// maxExclusive cũ vì người dùng lúc đó chỉ nói "chỗ đặt hàng siêu thị".
//
// Đợt 2 (người dùng yêu cầu "kiểm tra module đặt hàng HO luôn"): audit lại HO theo ĐÚNG tinh thần vừa
// chốt ở STORE — hoá ra HO đang mắc CHÍNH XÁC cùng 1 lớp lỗi quy ước biên giới (mốc đúng bằng 100 triệu
// bị đẩy LÊN mức cao hơn GTE100M thay vì ở lại mức thấp hơn) — đây KHÔNG phải quyết định giá trị nghiệp
// vụ mới (giá trị mốc 100 triệu KHÔNG đổi, vẫn đúng 2 mức), chỉ là cùng 1 bug quy ước vừa xác nhận sai ở
// STORE, nay sửa HO theo ĐÚNG khuôn: đổi luôn maxExclusive/"<" -> maxInclusive/"<=" cho HO, khớp 100%
// STORE — từ nay CẢ 2 mảng dùng chung 1 quy ước biên giới (không còn khác nhau), computeOperationOrder-
// Tier() gộp lại dùng chung 1 nhánh thay vì xử lý riêng STORE/HO như trước. Tier key (LT10M/
// FROM10M_TO100M/GTE100M/LT100M) KHÔNG đổi (chỉ đổi biên giới rơi vào key nào) nên cấu hình approver cũ
// theo tier key (operationOrderStoreTierWorkflows/operationOrderHOTierWorkflows) vẫn khớp nguyên, KHÔNG
// cần di trú dữ liệu.
//   Siêu Thị (STORE): ≤ 10.000.000đ | > 10.000.000đ và ≤ 100.000.000đ | > 100.000.000đ (3 mức)
//   HO:               ≤ 100.000.000đ | > 100.000.000đ (2 mức)
const OPERATION_ORDER_STORE_TIERS = [
  { key: 'LT10M', label: '≤ 10 triệu', maxInclusive: 10000000 },
  { key: 'FROM10M_TO100M', label: '> 10 triệu - ≤ 100 triệu', maxInclusive: 100000000 },
  { key: 'GTE100M', label: '> 100 triệu', maxInclusive: Infinity }
];
const OPERATION_ORDER_HO_TIERS = [
  { key: 'LT100M', label: '≤ 100 triệu', maxInclusive: 100000000 },
  { key: 'GTE100M', label: '> 100 triệu', maxInclusive: Infinity }
];

// Số tiền dùng làm căn cứ xét mức: lấy MAX(amount, paymentTotalAmount) — amount là tổng Số lượng × Đơn
// giá các hạng mục, server LUÔN tự tính lại (createValidation.js, không tin số client gửi) nên đáng tin
// cậy; paymentTotalAmount (Tổng Giá Trị Thanh Toán, đọc được từ PDF phiếu đặt hàng NCC) là field NGƯỜI
// DÙNG TỰ GÕ trên form — hợp lệ khi nó CAO HƠN amount (VD gồm VAT/phụ phí chưa liệt kê ở hạng mục), NHƯNG
// không được phép THẤP HƠN amount rồi kéo mức duyệt xuống thấp (dùng field tự gõ né bớt lớp duyệt của 1
// đơn hàng có tổng hạng mục thật sự cao) — xem tests/test-operation-order-location-tiers.js phần
// "Tamper: paymentTotalAmount giả mạo THẤP...". Trước đây hàm này ưu tiên paymentTotalAmount tuyệt đối
// bất kể amount cao hơn bao nhiêu — đã sửa.
function computeOperationOrderAmount(item) {
  const amount = Number(item?.amount) || 0;
  const paymentTotal = Number(item?.paymentTotalAmount) || 0;
  return Math.max(amount, paymentTotal);
}
function computeOperationOrderTier(locationType, amount) {
  // Cả STORE lẫn HO nay dùng CHUNG 1 quy ước: maxInclusive + "<=" (mốc đúng bằng rơi vào mức HIỆN TẠI,
  // không đẩy lên mức sau) — xem chú thích "Đợt 2" ở khối OPERATION_ORDER_*_TIERS phía trên.
  // locationType lạ/thiếu mặc định coi như HO (khớp resolveOperationOrderWorkflow() bên dưới).
  const tiers = locationType === 'STORE' ? OPERATION_ORDER_STORE_TIERS : OPERATION_ORDER_HO_TIERS;
  const found = tiers.find(t => amount <= t.maxInclusive);
  return (found || tiers[tiers.length - 1]).key;
}
// item.orderLocationType: 'STORE'|'HO', bắt buộc từ lib/createValidation.js lúc tạo (client gửi đúng
// giá trị theo sub-tab "Đặt Hàng Tại Siêu Thị"/"Đặt Hàng Tại HO" đang mở, KHÔNG có dropdown chọn tay —
// cùng cơ chế priceType RETAIL/WHOLESALE của itPriceApprovals). Hồ sơ CŨ trước đợt tách này không có
// field -> coi như 'HO' (migrateOperationOrdersDefaultLocationType(), seedDefaults.js di trú 1 lần).
//
// ĐỢT "Quy Trình Hỗn Hợp" (10/2026, thay THẾ HẲN cơ chế "Duyệt Đơn Hàng Siêu Thị tự khớp đúng siêu thị"
// trước đó — filterOperationOrderStoreApprovers(), nay đã xoá): người dùng không muốn tiếp tục phụ thuộc
// đúng 1 chức danh hardcode kiểu "Giám Đốc siêu thị" cho Bước 1, và muốn tự cấu hình linh động người/chức
// danh duyệt cho TỪNG bước qua màn admin mới "⚙️ Quy Trình Hỗn Hợp" (appData.operationOrderStoreMixed-
// ApprovalRules, mỗi dòng: {step, mode:'JOBTITLE'|'PERSON', jobTitle|username, stores[]}). Từ đợt này:
// - SỐ BƯỚC (steps) của đơn STORE vẫn lấy nguyên từ màn CŨ (operationOrderStoreTierWorkflows theo tier
//   giá trị đơn hàng) — người dùng xác nhận rõ "giữ màn hình cũ vì điều kiện mức tiền đã đúng rồi".
// - NGƯỜI DUYỆT (approvers) của mỗi bước KHÔNG còn lấy từ operationOrderStoreTierWorkflows[...].approvers
//   nữa (field approvers/approverMode/approversByPosition trong tier config STORE giờ chỉ còn tác dụng
//   hiển thị tham khảo ở màn cũ nếu còn, hoàn toàn không được đọc ở đây) — thay vào đó tra từ
//   resolveOperationOrderStoreMixedApprovers() bên dưới, dựa 100% vào operationOrderStoreMixedApprovalRules.
// - Được liệt kê ở đây (theo tên NGƯỜI hoặc CHỨC DANH) là ĐỦ điều kiện duyệt — KHÔNG cần bật thêm gì ở
//   "Quyền Đặc Biệt" (canBeApprover, khác hẳn cơ chế "Theo vị trí" cũ ở lib/positionApprovers.js vẫn dùng
//   cho các module KHÁC — Văn Phòng Phẩm/Thanh Toán/Xe/Giá IT/Hợp Đồng, xem yêu cầu người dùng nguyên văn
//   "sẽ ko lọc ở mục 17 quyền đặc biết trong admin").
// HO KHÔNG áp dụng cơ chế này (giữ nguyên như cũ — thuần theo mức giá trị, không có khái niệm "siêu thị").
function resolveOperationOrderStoreMixedApprovalRuleUsernames(rule, storeDept, users) {
  const hasExplicitStores = !!(rule.stores && rule.stores.length);
  // Dòng KHÔNG khai "Siêu Thị Phụ Trách" (mặc định) áp dụng cho MỌI siêu thị; dòng CÓ khai (ngoại lệ) chỉ
  // áp dụng đúng những siêu thị liệt kê. Cả 2 loại có thể cùng khớp 1 (bước, siêu thị) — không loại trừ
  // nhau, HỢP (UNION) lại ở resolveOperationOrderStoreMixedApprovers() bên dưới (phương án B, đã chốt).
  if (hasExplicitStores && !rule.stores.includes(storeDept)) return [];
  // LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Cao/Trung bình — phát hiện độc lập ở cả cụm Vận Hành lẫn
  // cụm Hệ Thống): trước đây KHÔNG lọc tài khoản đã bị khoá/nghỉ việc (u.active === false) ở CẢ 2 nhánh —
  // khác hẳn resolvePositionApprovers() (lib/positionApprovers.js, đã lọc `u.active !== false` từ đầu).
  // Hậu quả: 1 approver nghỉ việc vẫn nằm trong danh sách approvers[] của bước -> isStepApprovalComplete()
  // (đồng phê duyệt: TẤT CẢ phải duyệt) không bao giờ đủ điều kiện, bước treo VĨNH VIỄN (chỉ admin bypass
  // được). Lọc ngay tại đây (điểm tra cứu DUY NHẤT của cả 2 mode) — mirror đúng bản client
  // resolveOperationOrderStoreMixedApprovalRuleUsernamesClient() ở public/js/core.js, sửa 1 bên PHẢI sửa
  // cả 2 bên; màn cấu hình cũng cảnh báo rõ dòng không còn tác dụng (module-workflow.js).
  const isActiveUsername = (username) => (users || []).some(u => u && u.username === username && u.active !== false);
  if (rule.mode === 'PERSON') return (rule.username && isActiveUsername(rule.username)) ? [rule.username] : [];
  // mode 'JOBTITLE': dòng MẶC ĐỊNH (không khai siêu thị) tự khớp theo dept CHÍNH/"Vị Trí Kiêm Nhiệm" của
  // từng người giữ đúng chức danh với ĐÚNG siêu thị trên đơn — giữ nguyên đúng tiện lợi "GĐST tự khớp
  // đúng siêu thị mình", không cần liệt kê tay hàng chục siêu thị, đồng thời AN TOÀN (GĐST siêu thị A
  // không vô tình duyệt được đơn của siêu thị B). Dòng NGOẠI LỆ (có khai siêu thị, VD "Quản Lý Vùng" phụ
  // trách nhiều siêu thị không thuộc đúng 1 dept cố định nào) thì KHÔNG so dept — bản thân danh sách
  // "Siêu Thị Phụ Trách" của dòng đã là căn cứ duy nhất, không thể tự động khớp dept được.
  return (users || [])
    .filter(u => u && u.active !== false)
    .filter(u => u.jobTitle === rule.jobTitle)
    .filter(u => hasExplicitStores || u.dept === storeDept || (u.secondaryPositions || []).some(sp => sp.dept === storeDept))
    .map(u => u.username);
}
function resolveOperationOrderStoreMixedApprovers(rules, storeDept, users, stepOrders) {
  const approvers = {};
  (stepOrders || []).forEach(stepOrder => {
    const usernames = new Set();
    (rules || []).filter(r => Number(r.step) === Number(stepOrder)).forEach(r => {
      resolveOperationOrderStoreMixedApprovalRuleUsernames(r, storeDept, users).forEach(u => usernames.add(u));
    });
    approvers[stepOrder] = [...usernames];
  });
  return approvers;
}
function resolveOperationOrderWorkflow(item, appData) {
  const locationType = item.orderLocationType === 'STORE' ? 'STORE' : 'HO';
  const tierMap = locationType === 'STORE' ? appData.operationOrderStoreTierWorkflows : appData.operationOrderHOTierWorkflows;
  const tier = computeOperationOrderTier(locationType, computeOperationOrderAmount(item));
  const resolved = flatWorkflowConfigToSteps(tierMap?.[tier] || null, appData);
  if (locationType === 'STORE') {
    const stepOrders = resolved.steps.map(s => s.order);
    const approvers = resolveOperationOrderStoreMixedApprovers(appData.operationOrderStoreMixedApprovalRules, item.dept, appData.users, stepOrders);
    return { steps: resolved.steps, approvers };
  }
  return resolved;
}

// ===== Hợp đồng — 2 quy trình TÁCH RIÊNG trên CÙNG 1 bản ghi contracts (khớp index.html) =====
// 1) "Phê Duyệt" (contracts): approvalStatus/currentStep/history — quy trình theo phòng ban + tối đa 4
//    lớp bổ sung tuỳ chọn (GD_PGD/PTGD/TRO_LY_THU_KY/TGD), snapshot effectiveSteps/effectiveApprovers
//    lúc tạo (khớp cơ chế Văn Bản Trình, xem buildEffectiveContractApprovalWorkflowServer ở
//    lib/createValidation.js), NHƯNG bỏ Đồng trình/Xin ý kiến/Phê duyệt đồng cấp và dùng nhóm phê duyệt
//    RIÊNG (contractApprovalGroups) — không dùng chung dữ liệu với Văn Bản Trình.
// 2) "Quản Lý HĐ" (Tài liệu ký, module key ảo "contractsSignedFile" — cùng dbKey 'contracts' nhưng field
//    riêng signedFileStatus/signedFileCurrentStep/signedFileHistory): quy trình ĐƠN GIẢN theo phòng ban
//    (giống Xe/Mua Bán/VPP — không snapshot, tra cấu hình admin MỚI NHẤT mỗi lần duyệt), độc lập hoàn
//    toàn với quy trình Phê Duyệt ở trên.
function resolveContractApprovalWorkflow(item, appData) {
  if (item.effectiveSteps && item.effectiveApprovers) {
    return { steps: item.effectiveSteps, approvers: item.effectiveApprovers };
  }
  const deptMap = appData.contractApprovalDeptWorkflows || {};
  const baseConfig = deptMap[item.dept] || { workflowId: 'WF_1STEP', approvers: { 1: ['admin'] } };
  return flatWorkflowConfigToSteps(baseConfig, appData);
}

function resolveContractManageWorkflow(item, appData) {
  return flatWorkflowConfigToSteps(appData.contractManageDeptWorkflows?.[item.dept], appData);
}

// Cấu hình từng module — CHỈ những gì khác nhau: khoá collection AppData và cách tra ra {steps,
// approvers} của 1 hồ sơ cụ thể. Phần logic chuyển bước/duyệt/từ chối dùng chung applyWorkflowAction().
// statusField/currentStepField/historyField mặc định 'status'/'currentStep'/'history' — chỉ hợp đồng
// cần khai riêng (approvalStatus cho luồng gốc, "contractsSignedFile" ảo cho luồng Tài liệu ký, vì cả 2
// đều nằm trên CÙNG 1 bản ghi contracts nên không thể dùng chung tên field currentStep/history).
const MODULE_CONFIGS = {
  // "Bổ Sung" (REQUEST_CHANGES) — mở rộng cho ĐỦ các module dùng chung engine này (đợt yêu cầu nghiệp
  // vụ "mọi module có quy trình phê duyệt đều cần nút bổ sung", xem lib/recordActions.js
  // editDocDraft()/editCarRegDraft()/editOfficeReqDraft()/editSubmissionDraft() — cùng khuôn
  // updateVppRegistrationDraft()/updateBudgetEntryDraft() đã có sẵn ở trên): người duyệt bước hiện tại
  // trả hồ sơ về NHÁP (status/currentStep reset, xem applyWorkflowAction() REQUEST_CHANGES ở dưới),
  // người tạo SỬA LẠI TOÀN BỘ nội dung (kể cả tệp đính kèm, nếu có) rồi "Gửi Lại" từ bước 1 — không
  // phải REQUEST_INFO (giữ nguyên PENDING, chỉ đính kèm 1 ghi chú, xem itPriceApprovals bên dưới — MODULE
  // NÀY GIỮ NGUYÊN, không đổi gì).
  docs: {
    dbKey: 'docs',
    resolveWfConfig: (item, appData) => flatWorkflowConfigToSteps(appData.deptWorkflows?.[item.dept], appData),
    supportsRequestChanges: true
  },
  submissions: {
    dbKey: 'submissions',
    resolveWfConfig: (item, appData) => resolveSubmissionWorkflow(item, appData),
    // Trước đây có thêm supportsRequestInfo (kênh ghi 1 ghi chú, KHÔNG đổi status/currentStep) song
    // song với supportsRequestChanges — đã gỡ theo yêu cầu người dùng: Văn Bản Trình chỉ còn giữ ĐÚNG 1
    // nút "Yêu Cầu Bổ Sung" (REQUEST_CHANGES, đưa về NHÁP để người trình sửa lại toàn bộ nội dung + tệp
    // rồi gửi lại từ bước 1, xem editSubmissionDraft() ở lib/recordActions.js). itPriceApprovals bên
    // dưới vẫn giữ nguyên supportsRequestInfo, không đụng tới.
    supportsRequestChanges: true
  },
  carRegs: {
    dbKey: 'carRegs',
    resolveWfConfig: (item, appData) => flatWorkflowConfigToSteps(appData.carDeptWorkflows?.[item.dept], appData),
    // assignedDriver KHÔNG còn nằm trong danh sách này — lái xe giờ bắt buộc là 1 tài khoản hệ thống có
    // thật (xem xử lý riêng ở applyWorkflowAction() bên dưới), server tự tra display name từ user thay
    // vì tin bất kỳ text nào client gửi kèm.
    extraFields: ['assignedVehicleType', 'assignedPlate', 'assignedTaxiCompany'],
    supportsRequestChanges: true
  },
  officeReqs: {
    dbKey: 'officeReqs',
    resolveWfConfig: (item, appData) => {
      const mapKey = OFFICE_SUBTYPE_TO_DBKEY[item.subType] || 'officeBuyDeptWorkflows';
      return flatWorkflowConfigToSteps(appData[mapKey]?.[item.dept], appData);
    },
    supportsRequestChanges: true
  },
  vppRegistrations: {
    dbKey: 'vppRegistrations',
    resolveWfConfig: (item, appData) => flatWorkflowConfigToSteps(appData.vppDeptWorkflows?.[item.dept], appData),
    supportsRequestChanges: true
  },
  contracts: {
    dbKey: 'contracts',
    statusField: 'approvalStatus',
    resolveWfConfig: (item, appData) => resolveContractApprovalWorkflow(item, appData),
    // editContract() (lib/recordActions.js) ĐÃ sẵn sàng cho nhánh này từ trước (tự đưa DRAFT/REJECTED
    // về PENDING/bước 1 khi người tạo sửa xong) — chỉ còn thiếu đúng 1 hành động REQUEST_CHANGES để
    // người duyệt chủ động trả hồ sơ về NHÁP (khác hẳn Từ chối hẳn/REJECTED).
    supportsRequestChanges: true
  },
  contractsSignedFile: {
    dbKey: 'contracts',
    statusField: 'signedFileStatus',
    currentStepField: 'signedFileCurrentStep',
    historyField: 'signedFileHistory',
    resolveWfConfig: (item, appData) => resolveContractManageWorkflow(item, appData),
    // uploadContractSignedFile() (lib/recordActions.js) ĐÃ tự đưa signedFileStatus về PENDING/bước 1 mỗi
    // lần tải lại tệp — chỉ còn thiếu hành động REQUEST_CHANGES để người duyệt chủ động trả về NHÁP
    // (khác Từ chối hẳn) trước khi người phụ trách tải lại Tài liệu ký.
    supportsRequestChanges: true,
    // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 9/2026, form có điều kiện phê duyệt): assertNotSelfDecidingWorkflowItem()
    // mặc định chặn theo creatorField của dbKey ('contracts' -> 'creator') — tức người TẠO HỢP ĐỒNG GỐC.
    // Nhưng "Tài liệu ký" là 1 quy trình RIÊNG (custodianDept có thể KHÁC hẳn phòng ban tạo hợp đồng,
    // xem createValidation.js) — người thực sự "trình" 1 lượt duyệt của quy trình NÀY là người vừa TẢI
    // TÀI LIỆU KÝ LÊN (contract.signedUploadedBy, ghi ở uploadContractSignedFile()), không phải người tạo
    // hợp đồng gốc. Trước đây chỉ chặn đúng creator -> người tải tài liệu ký lên (thường 1 nhân sự phòng
    // custodianDept khác) vẫn tự duyệt được tài liệu do chính mình vừa tải, nếu họ cũng nằm trong danh
    // sách approver phòng ban đó. extraSelfDecidingField bổ sung field THỨ 2 cần chặn (CÙNG VỚI creator,
    // không thay thế) — xem assertNotSelfDecidingWorkflowItem() bên dưới.
    extraSelfDecidingField: 'signedUploadedBy'
  },
  // "Phê Duyệt Giá" (Hỗ Trợ IT) — duyệt giá bán mặt hàng siêu thị theo phòng ban, cùng khuôn docs/
  // carRegs/officeReqs ở trên (không snapshot, tra cấu hình admin MỚI NHẤT mỗi lần duyệt). Bước "IT áp
  // giá + xác nhận hoàn thành" sau khi APPROVED KHÔNG đi qua engine này — xem applyPriceApproval() ở
  // lib/recordActions.js, route riêng POST /api/records/itPriceApprovals/:id/apply.
  itPriceApprovals: {
    dbKey: 'itPriceApprovals',
    // item.priceType: fallback 'RETAIL' cho hồ sơ CŨ chưa có field này (mục 1 kế hoạch) — khớp
    // resolveItPriceDeptWorkflowConfig() ở trên đọc đúng nhánh RETAIL/WHOLESALE (hoặc cấu hình phẳng cũ).
    // WHOLESALE (mục B kế hoạch mới): bỏ hẳn quy trình theo phòng ban, tra theo item.priceTier (1 trong
    // 4 mức Margin/Chiết Khấu cố định) qua resolveItPriceTierWorkflowConfig() — RETAIL GIỮ NGUYÊN hành
    // vi cũ 100% (nhánh này giờ chỉ còn chạy khi priceType chắc chắn là RETAIL).
    resolveWfConfig: (item, appData) => {
      if ((item.priceType || 'RETAIL') === 'WHOLESALE') {
        return flatWorkflowConfigToSteps(
          resolveItPriceTierWorkflowConfig(appData.itPriceTierWorkflows, item.priceTier), appData
        );
      }
      return flatWorkflowConfigToSteps(
        resolveItPriceDeptWorkflowConfig(appData.itPriceDeptWorkflows, item.dept, 'RETAIL'), appData
      );
    },
    // Người duyệt phòng ban ở bước hiện tại có thể yêu cầu bổ sung (vd file có dòng giá bất thường) mà
    // KHÔNG từ chối hẳn — ghi vào item.infoRequests dùng CHUNG với yêu cầu bổ sung của đội Hỗ Trợ IT sau
    // khi đã APPROVED (xem requestPriceInfoFromIt() ở lib/recordActions.js, và extraValidate của
    // itPriceApprovals ở lib/createValidation.js để biết lý do dùng chung 1 mảng).
    supportsRequestInfo: true,
    // Còn ít nhất 1 yêu cầu bổ sung CHƯA được người đề xuất phản hồi (chưa tải tệp bổ sung) -> chặn
    // Duyệt/Từ chối ở ĐÚNG bước đang chờ đó, để người duyệt luôn thấy đủ tệp mới nhất + bảng so sánh
    // trước khi quyết định (đúng yêu cầu nghiệp vụ: không phê duyệt trong lúc còn yêu cầu bổ sung treo).
    blockApproveIf: (item) => ((item.infoRequests || []).some(r => !r.response))
      ? 'Đề xuất đang có yêu cầu bổ sung chưa được người đề xuất phản hồi (tải tệp bổ sung), chưa thể duyệt/từ chối.'
      : null
  },
  // Ngân Sách — Trưởng phòng duyệt bản ngân sách của phòng ban mình theo appData.budgetDeptWorkflows
  // (cùng khuôn docs/carRegs/officeReqs/itPriceApprovals ở trên). supportsRequestChanges (không phải
  // supportsRequestInfo) vì "nút bổ sung" cần đưa hẳn hồ sơ về NHÁP để người lập SỬA LẠI trực tiếp các
  // dòng ngân sách rồi gửi lại từ đầu (đúng khuôn vppRegistrations — nội dung cần sửa là số liệu cụ thể,
  // không chỉ đính kèm thêm giấy tờ như itPriceApprovals).
  budgetEntries: {
    dbKey: 'budgetEntries',
    resolveWfConfig: (item, appData) => flatWorkflowConfigToSteps(appData.budgetDeptWorkflows?.[item.dept], appData),
    supportsRequestChanges: true,
    // PHÁT HIỆN ở đợt audit chuyên sâu lần 2: applyWorkflowAction() (Duyệt/Từ chối) trước đây KHÔNG kiểm
    // tra kỳ ngân sách đã đóng sổ hay chưa — khác hẳn updateBudgetEntryDraft()/submitBudgetEntry() (đều
    // gọi isBudgetPeriodClosed() ở lib/recordActions.js) — Trưởng phòng vẫn duyệt/từ chối được 1 bản NGÂN
    // SÁCH PENDING dù kỳ đã đóng sổ (hết hạn hoặc admin đóng thủ công), làm sai lệch số liệu đã chốt sau
    // khi báo cáo tổng hợp đã phát hành. Require trễ (bên trong hàm) tránh vòng lặp require giữa
    // workflowEngine.js và recordActions.js (đã có ở nơi khác trong file này, xem chú thích MODULE_CONFIGS).
    blockApproveIf: (item, appData) => {
      const { isBudgetPeriodClosed } = require('./recordActions');
      const period = (appData?.budgetPeriods || []).find(p => p.id === item.periodId);
      return period && isBudgetPeriodClosed(period)
        ? 'Kỳ ngân sách này đã kết thúc, không thể duyệt/từ chối nữa'
        : null;
    }
  },
  // Vận Hành > Đơn Hàng — ĐỔI HẲN từ quy trình duyệt theo phòng ban (operationOrderDeptWorkflows, đã bị
  // xoá khỏi AppData/admin UI) sang quy trình duyệt theo MỨC GIÁ TRỊ đơn hàng, TÁCH RIÊNG hoàn toàn cho
  // "Đặt Hàng Tại Siêu Thị" (STORE, 3 mức) và "Đặt Hàng Tại HO" (HO, 2 mức) — xem
  // resolveOperationOrderWorkflow()/OPERATION_ORDER_STORE_TIERS/OPERATION_ORDER_HO_TIERS ở trên. Mức tự
  // tính lại NGAY TẠI ĐÂY mỗi lần cần (không tin/không lưu giá trị nào client tự gửi).
  // operationStoreOpenings/operationRepairs ĐÃ BỊ XOÁ khỏi đây (Mục H, 60c473b — bỏ hẳn phê duyệt cho 2
  // luồng "Siêu Thị": status đi thẳng APPROVED ngay lúc tạo ở lib/createValidation.js, không bao giờ vào
  // PENDING nữa nên applyWorkflowAction()/route generic /api/workflow/<module>/:id/:action cho 2 module
  // này chỉ còn ném lỗi 409 "không ở trạng thái chờ xử lý" — dọn hẳn cấu hình thay vì để lại 1 route
  // chết). Bản ghi CŨ (trước Mục H) còn kẹt PENDING/DRAFT được migrateStuckOperationApprovalStatuses()
  // (seedDefaults.js) tự chuyển sang APPROVED mỗi lúc khởi động. dept-workflow map
  // operationStoreOpenDeptWorkflows/operationRepairDeptWorkflows ĐÃ XOÁ HẲN khỏi defaults.js/VALID_KEYS
  // (yêu cầu người dùng, đợt sau — trước đó vẫn giữ trong AppData cho màn cấu hình cũ xem lại, nhưng màn
  // đó ("QT QLDA - Mở Mới/Sửa Chữa Siêu Thị" ở tab "Quy Trình & Phê Duyệt") cũng đã bị gỡ luôn, xem
  // WF_MODULE_CONFIG ở module-workflow.js) — canViewOperationStoreOpening()/canViewOperationRepair()
  // (lib/recordViewScope.js) đã bỏ nhánh "đang là approver" tương ứng, chỉ còn dept/hasOwnWorkItemInSource/
  // approver của Danh mục đầu tư (vẫn giữ nguyên object bên dưới).
  //
  // Giai đoạn "Dự toán" (Danh Mục Đầu Tư) của 2 luồng "Siêu Thị" CŨNG ĐÃ BỊ XOÁ khỏi đây — chủ ứng dụng
  // xác nhận: KHÔNG có bước phê duyệt nào ở Vận Hành > Siêu Thị cả (kể cả Dự Toán), để người quản lý
  // (trưởng phòng) tự lập/lưu, không cần ai duyệt. submitOperationEstimate() (lib/recordActions.js) đã
  // tự lưu thẳng estimateStatus = 'APPROVED' (không qua PENDING) từ trước, xoá 2 module ẢO
  // operationStoreOpeningEstimate/operationRepairEstimate ở đây là dọn nốt cấu hình đã thành giàn giáo
  // chết (route generic /api/workflow/<module>/:id/:action cho 2 module này vốn đã luôn ném lỗi 409, giờ
  // trả lỗi "module không hợp lệ" thay vì 409 — cùng tinh thần dọn ở trên). 2 map
  // operationStoreOpenEstimateDeptWorkflows/operationRepairEstimateDeptWorkflows cũng đã xoá khỏi
  // defaults.js/routes/data.js ADMIN_ONLY_KEYS — không còn màn admin nào cấu hình được nữa.
  operationOrders: {
    dbKey: 'operationOrders',
    resolveWfConfig: (item, appData) => resolveOperationOrderWorkflow(item, appData),
    supportsRequestChanges: true
  },
  // Thanh Toán — "Chuyển Xác Nhận Thanh Toán" (PENDING -> APPROVED, đề nghị chung cho CẢ Hợp đồng/Mua
  // Bán/Sửa Chữa/thủ công, xem lib/recordActions.js submitPaymentRequest()) giờ đi qua quy trình duyệt
  // THEO BƯỚC/PHÒNG BAN (paymentDeptWorkflows, không snapshot — tra cấu hình admin MỚI NHẤT mỗi lần
  // duyệt, cùng khuôn contractsSignedFile/Xe/Mua Bán/VPP ở trên), thay cho quyền phẳng
  // canManagePaymentRequests() (admin||paymentManage) trước đây. Chỉ Duyệt (APPROVE) đi qua engine này —
  // KHÔNG wire REJECT (disallowReject: true, xem applyWorkflowAction() bên dưới): paymentRequests không
  // có khái niệm REJECTED, chỉ có NEED_INFO (giữ nguyên NGOÀI engine này — requestPaymentInfo() ở
  // lib/recordActions.js, KHÔNG đổi) — quyết định đã chốt với người dùng.
  paymentRequests: {
    dbKey: 'paymentRequests',
    resolveWfConfig: (item, appData) => flatWorkflowConfigToSteps(appData.paymentDeptWorkflows?.[item.dept], appData),
    disallowReject: true,
    // NGOẠI LỆ đã CHỐT với người dùng từ trước (xác nhận qua bộ test tests/test-payment.js, kịch bản
    // 10/18 — "ketoan1 (approver bước 1 dept 'Phòng Kế Toán') duyệt được đề nghị thủ công của chính
    // mình"): đề nghị thanh toán "thủ công" (sourceModule='MANUAL', không gắn nguồn nào từ module khác)
    // do CHÍNH kế toán phòng ban tự lập rồi tự xác nhận là nghiệp vụ BÌNH THƯỜNG (khác các module còn
    // lại — luôn có 1 NGƯỜI KHÁC đứng ra đề xuất, phê duyệt cần độc lập với người đó) — KHÔNG áp dụng
    // assertNotSelfDecidingWorkflowItem() (mục Cao, rà soát bảo mật trước golive 9/2026) cho module này,
    // để không phá vỡ luồng nghiệp vụ đã có từ trước.
    // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 9/2026, form có điều kiện phê duyệt): allowSelfDeciding TRƯỚC ĐÂY
    // là cờ PHẲNG áp dụng cho TOÀN BỘ module bất kể sourceModule — nới lỏng oan sang CẢ đề nghị phát sinh
    // từ Hợp Đồng/Mua Bán/Sửa Chữa (sourceModule='CONTRACT'/'MUA_BAN'/'SUA_CHUA', xem
    // startContractPayment()/startOfficePayment() ở lib/recordActions.js) — những đề nghị đó VẪN CẦN tách
    // biệt người đề xuất/duyệt như mọi module khác, KHÔNG nằm trong ngoại lệ đã chốt. Đổi allowSelfDeciding
    // thành HÀM (item) => boolean thay vì cờ tĩnh — assertNotSelfDecidingWorkflowItem() bên dưới gọi ĐÚNG
    // hàm này với item cụ thể, chỉ true khi sourceModule THẬT SỰ là 'MANUAL'.
    allowSelfDeciding: (item) => (item.sourceModule || 'MANUAL') === 'MANUAL'
  }
};

// Giữ tên "WorkflowError" (export riêng, dùng ở routes/workflow.js + stub test) nhưng dùng chung 1
// class lỗi HTTP với lib/createValidation.js — xem lib/httpErrors.js.
const { HttpError: WorkflowError } = require('./httpErrors');
// Chỉ lấy DUY NHẤT hàm kiểm khuôn URL tệp tải lên (hàm thuần, không đọc DB) — 1 nguồn sự thật chung
// với lib/createValidation.js/lib/recordActions.js, tránh chép lại regex ở đây (xem
// PROPOSE_FILE_REPLACEMENT bên dưới). Lưu ý: đây KHÔNG mâu thuẫn với "LƯU Ý BẢO TRÌ" ở đầu file — ghi
// chú đó nói về việc không import chung được với public/index.html (trình duyệt), không phải giữa 2
// module server với nhau; không có phụ thuộc vòng vì createValidation.js không require file này.
const { assertUploadedFileUrl, CREATE_MODULE_CONFIGS } = require('./createValidation');

const nowVN = () => new Date().toLocaleString('vi-VN');

// Chặn TỰ DUYỆT/TỰ XỬ LÝ hồ sơ do chính mình tạo — vá lỗ hổng mức Cao phát hiện ở đợt rà soát bảo mật
// trước golive (9/2026): canApproveStep() (đầu file) chỉ kiểm "có tên trong danh sách approver bước
// hiện tại + chưa từng duyệt bước này" — KHÔNG loại trừ chính người tạo/trình hồ sơ, nên 1 trưởng phòng
// vừa tạo vừa là approver DUY NHẤT bước 1 của phòng mình (khá phổ biến ở phòng nhỏ) tự duyệt được luôn,
// không ai kiểm soát độc lập — ảnh hưởng MỌI module đi qua applyWorkflowAction() (docs/submissions/
// carRegs/officeReqs/contracts/contractsSignedFile/itPriceApprovals/budgetEntries/operationOrders/
// paymentRequests). Module budgetLines (Ngân Sách 2.0, KHÔNG dùng engine này) đã có cơ chế riêng
// tương tự từ trước (assertNotSelfDecidingBudgetLine(), lib/recordActions.js) — hàm này mirror ĐÚNG
// tinh thần đó cho cụm module còn lại, TÁCH RIÊNG khỏi canApproveStep() (không đổi chữ ký hàm đó — nó
// được dùng ở ~10 file public/js/*.js CHỈ để ẩn/hiện nút, đổi chữ ký sẽ đụng quá rộng, rủi ro hồi quy
// cao ngay trước golive) để CHỈ chặn ở ĐÚNG 1 điểm gác thật (applyWorkflowAction(), nơi hành động THẬT
// SỰ ghi xuống DB) — client vẫn hiện nút Duyệt bình thường cho tới khi bấm mới bị chặn 403 kèm thông
// điệp rõ ràng, chấp nhận được vì đây là tình huống hiếm (tự tạo + tự là approver duy nhất).
//
// Dùng LẠI creatorField đã có sẵn trong CREATE_MODULE_CONFIGS (lib/createValidation.js — mỗi module
// khai đúng 1 lần khi TẠO hồ sơ, xem `record[config.creatorField] = user.username;`) thay vì tự khai
// lại field tên gì cho từng module ở ĐÂY — 1 nguồn sự thật duy nhất, tự động đúng nếu sau này có module
// mới thêm vào MODULE_CONFIGS. "contractsSignedFile" (module ẢO, dbKey='contracts') tự động tra đúng
// sang creatorField của "contracts" qua dbKey, không cần khai riêng.
//
// Admin KHÔNG bị chặn (giữ nguyên đặc quyền vượt mọi cấu hình approver, nhất quán với canApproveStep()/
// isStepApprovalComplete() ở trên và toàn bộ phần còn lại của hệ thống) — khác budgetLines (chặn CẢ
// admin), vì đây là quyết định phạm vi hẹp của riêng module budgetLines, không áp dụng ngược lại đây.
//
// MODULE_CONFIGS[moduleKey].allowSelfDeciding — ngoại lệ cho module đã có SẴN nghiệp vụ hợp lệ tự tạo +
// tự xử lý (hiện chỉ paymentRequests — xem chú thích ngay tại entry đó ở MODULE_CONFIGS phía trên). Phát
// hiện ĐÚNG lúc chạy full regression sau khi thêm hàm này lần đầu: tests/test-payment.js đã có sẵn 2 kịch
// bản (10/18) xác nhận đây là hành vi ĐÃ CHỐT, không phải lỗ hổng — không phải MỌI module dùng chung
// engine này đều cần cùng 1 luật tự duyệt. Có thể là boolean (áp dụng CẢ item) hoặc hàm (item) => boolean
// (áp dụng CÓ ĐIỀU KIỆN theo từng bản ghi — xem paymentRequests: chỉ đúng sourceModule==='MANUAL', LỖI ĐÃ
// VÁ đợt rà soát 9/2026: trước đây là boolean tĩnh nên nới lỏng oan sang CẢ đề nghị phát sinh từ Hợp
// Đồng/Mua Bán/Sửa Chữa, vốn KHÔNG nằm trong phạm vi ngoại lệ đã chốt với người dùng).
//
// MODULE_CONFIGS[moduleKey].extraSelfDecidingField — field THỨ 2 (ngoài creatorField suy từ dbKey) cần
// chặn tự xử lý, cho module mà "người tạo bản ghi gốc" KHÁC "người trình lượt duyệt này" (hiện chỉ
// contractsSignedFile — signedUploadedBy, xem chú thích tại entry đó).
function assertNotSelfDecidingWorkflowItem(moduleKey, item, user) {
  if (user?.perms?.admin) return;
  const allowSelfDeciding = MODULE_CONFIGS[moduleKey]?.allowSelfDeciding;
  const allowed = typeof allowSelfDeciding === 'function' ? allowSelfDeciding(item) : !!allowSelfDeciding;
  if (allowed) return;
  const dbKey = MODULE_CONFIGS[moduleKey]?.dbKey || moduleKey;
  const creatorField = CREATE_MODULE_CONFIGS[dbKey]?.creatorField;
  const extraField = MODULE_CONFIGS[moduleKey]?.extraSelfDecidingField;
  const blockedUsernames = [
    creatorField ? item[creatorField] : null,
    extraField ? item[extraField] : null
  ].filter(Boolean);
  if (blockedUsernames.includes(user.username)) {
    throw new WorkflowError(403, 'Bạn không thể tự xử lý (duyệt/từ chối/yêu cầu bổ sung) hồ sơ do chính mình tạo hoặc trình');
  }
}

// Thực hiện HÀNH ĐỘNG (APPROVE/REJECT) trên 1 hồ sơ — mọi kiểm tra quyền đều dựa vào approver list
// đã resolve từ đúng cấu hình quy trình của module đó, KHÔNG tin bất kỳ trường status/currentStep
// nào client có thể tự gửi kèm — server tự tính toán lại toàn bộ dựa trên state hiện có + hành động.
function applyWorkflowAction({ moduleKey, item, action, user, comment, extraFields, appData, existingCollection, users }) {
  const config = MODULE_CONFIGS[moduleKey];
  if (!config) throw new WorkflowError(400, `Module không hợp lệ: ${moduleKey}`);
  if (!item) throw new WorkflowError(404, 'Không tìm thấy hồ sơ');
  // Tên field trạng thái/bước hiện tại/lịch sử — mặc định 'status'/'currentStep'/'history', chỉ hợp
  // đồng khai riêng vì 1 bản ghi contracts mang 2 quy trình độc lập (xem MODULE_CONFIGS ở trên).
  const statusField = config.statusField || 'status';
  const currentStepField = config.currentStepField || 'currentStep';
  const historyField = config.historyField || 'history';
  if (item[statusField] !== 'PENDING') throw new WorkflowError(409, 'Hồ sơ không còn ở trạng thái chờ xử lý (có thể đã được xử lý ở nơi khác)');

  // Hook tuỳ chọn theo module (itPriceApprovals: yêu cầu bổ sung treo; budgetEntries: kỳ đã đóng sổ) —
  // chặn MỌI hành động THAY ĐỔI TRẠNG THÁI hồ sơ (Duyệt/Từ chối/Yêu cầu bổ sung) khi hồ sơ đang có điều
  // kiện riêng chưa thoả. Không đụng tới module khác.
  // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 9/2026, form có điều kiện phê duyệt): trước đây CHỈ gate cho
  // APPROVE/REJECT — REQUEST_CHANGES (và REQUEST_INFO, nếu module nào sau này bật cả 2) đi thẳng qua mà
  // KHÔNG kiểm tra blockApproveIf. Với budgetEntries cụ thể: người duyệt vẫn "Yêu Cầu Bổ Sung" được 1 bản
  // ghi PENDING của kỳ ngân sách ĐÃ ĐÓNG SỔ dù Duyệt/Từ Chối bị chặn đúng lý do đó — đưa hồ sơ về NHÁP rồi
  // kẹt vĩnh viễn (updateBudgetEntryDraft()/submitBudgetEntry() cũng chặn sửa/gửi lại khi kỳ đã đóng, xem
  // lib/recordActions.js), không còn đường quay lại PENDING/APPROVED.
  if (config.blockApproveIf && ['APPROVE', 'REJECT', 'REQUEST_CHANGES', 'REQUEST_INFO'].includes(action)) {
    const blockedReason = config.blockApproveIf(item, appData);
    if (blockedReason) throw new WorkflowError(409, blockedReason);
  }

  const { steps, approvers } = config.resolveWfConfig(item, appData);
  const currentStep = item[currentStepField];
  const currentStepApprovers = approvers?.[currentStep] || [];
  const stepName = steps[currentStep - 1]?.name || `Bước ${currentStep}`;

  if (!item[historyField]) item[historyField] = [];

  // Nhóm được admin cấp cờ allowFileReplacementProposal (chỉ Văn Bản Trình — xem
  // appData.submissionApprovalGroups ở defaults.js) có thể đề xuất
  // THAY THẾ TOÀN BỘ tệp tờ trình thay vì chỉ ghi bình luận bổ sung (PROPOSE_FILE_REPLACEMENT bên
  // dưới) — trong lúc đề xuất đó CHƯA được người trình xác nhận (RESOLVE_FILE_PROPOSAL), hồ sơ vẫn
  // PENDING nhưng "treo" — chặn mọi hành động Duyệt/Từ chối/Yêu cầu bổ sung/đề xuất mới khác để tránh
  // 2 luồng xử lý cùng lúc trên 1 nội dung chưa chốt.
  if (item.pendingFileProposal && ['APPROVE', 'REJECT', 'REQUEST_CHANGES', 'PROPOSE_FILE_REPLACEMENT'].includes(action)) {
    throw new WorkflowError(409, 'Tờ trình đang chờ người trình xác nhận đề xuất thay thế nội dung, chưa thể xử lý.');
  }

  // CANCEL_FILE_PROPOSAL — LỐI THOÁT cho hồ sơ bị KHOÁ CỨNG bởi 1 đề xuất thay thế tệp treo mãi (LỖI ĐÃ
  // VÁ, đợt audit chuyên sâu cụm "Văn Bản Trình/..."): khối chặn ngay phía trên khoá mọi hành động xử lý
  // khi có pendingFileProposal, mà đường GỠ duy nhất (RESOLVE_FILE_PROPOSAL bên dưới) lại CHỈ mở cho
  // ĐÚNG item.creator — người trình nghỉ việc/bị khoá tài khoản/đi vắng dài ngày là tờ trình kẹt vĩnh
  // viễn, admin cũng không gỡ được (nhánh 403 đó KHÔNG có ngoại lệ admin như mọi nhánh khác trong file).
  // Cho phép admin HOẶC chính người đã đề xuất (proposedBy — tự rút lại đề xuất của mình) huỷ đề xuất:
  // hồ sơ trở về đúng trạng thái TRƯỚC khi có đề xuất (vẫn PENDING ở bước cũ, KHÔNG đụng currentStep/
  // lịch sử duyệt — khác hẳn RESOLVE_FILE_PROPOSAL vốn là 1 quyết định nghiệp vụ thật của người trình).
  if (action === 'CANCEL_FILE_PROPOSAL') {
    if (moduleKey !== 'submissions') throw new WorkflowError(400, 'Chỉ áp dụng cho Văn Bản Trình');
    const proposal = item.pendingFileProposal;
    if (!proposal) throw new WorkflowError(409, 'Tờ trình này không có đề xuất thay thế nào đang chờ xác nhận');
    if (!user?.perms?.admin && proposal.proposedBy !== user.username) {
      throw new WorkflowError(403, 'Chỉ Quản Trị Viên hoặc chính người đã đề xuất mới được huỷ đề xuất thay thế tờ trình này');
    }
    item[historyField].push({
      step: proposal.step, approver: user.name, username: user.username, action: 'FILE_PROPOSAL_CANCELLED',
      comment: comment || '', time: nowVN(), fileName: proposal.fileName, fileUrl: proposal.fileUrl
    });
    item.pendingFileProposal = null;
    return { item, transition: { type: 'CANCEL_FILE_PROPOSAL' } };
  }

  if (action === 'REQUEST_INFO') {
    if (!config.supportsRequestInfo) throw new WorkflowError(400, 'Module này không hỗ trợ yêu cầu bổ sung');
    if (!comment) throw new WorkflowError(400, 'Vui lòng nhập nội dung cần bổ sung');
    if (!canApproveStep(user, currentStepApprovers, item[historyField], currentStep)) {
      throw new WorkflowError(403, 'Bạn không có quyền yêu cầu bổ sung ở bước hiện tại, hoặc đã xử lý bước này rồi');
    }
    assertNotSelfDecidingWorkflowItem(moduleKey, item, user);
    if (!item.infoRequests) item.infoRequests = [];
    const reqEntry = {
      id: Date.now(), step: currentStep,
      requestedBy: user.username, requestedByName: user.name,
      reason: comment, requestedAt: nowVN(),
      response: null, respondedAt: null,
      byRole: 'approver' // đến từ người duyệt bước hiện tại — phân biệt với 'it' (xem itPriceApprovals)
    };
    item.infoRequests.push(reqEntry);
    item[historyField].push({ step: currentStep, approver: user.name, username: user.username, action: 'REQUEST_INFO', comment, time: reqEntry.requestedAt });
    return { item, transition: { type: 'REQUEST_INFO' } };
  }

  // Khác REQUEST_INFO (chỉ ghi thêm 1 dòng phản hồi, giữ nguyên PENDING — dùng cho Văn bản trình):
  // REQUEST_CHANGES đưa hẳn hồ sơ về NHÁP để người tạo SỬA LẠI nội dung rồi gửi lại từ đầu — hợp lý hơn
  // cho Văn phòng phẩm vì nội dung cần sửa là số lượng/mặt hàng cụ thể, không chỉ bổ sung giấy tờ.
  if (action === 'REQUEST_CHANGES') {
    if (!config.supportsRequestChanges) throw new WorkflowError(400, 'Module này không hỗ trợ yêu cầu bổ sung/chỉnh sửa');
    if (!comment) throw new WorkflowError(400, 'Vui lòng nhập lý do yêu cầu bổ sung/chỉnh sửa');
    if (!canApproveStep(user, currentStepApprovers, item[historyField], currentStep)) {
      throw new WorkflowError(403, 'Bạn không có quyền yêu cầu bổ sung ở bước hiện tại, hoặc đã xử lý bước này rồi');
    }
    assertNotSelfDecidingWorkflowItem(moduleKey, item, user);
    // Hồ sơ quay lại NHÁP để sửa & GỬI LẠI TỪ ĐẦU (currentStep về 0) — mọi lượt "APPROVED" đã ghi ở
    // vòng nộp TRƯỚC không còn giá trị cho vòng MỚI (nội dung đã đổi), nhưng vẫn giữ nguyên trong lịch
    // sử để tra cứu — đánh dấu invalidated để getStepApprovedUsernames() không tính nhầm là "đã duyệt
    // bước này rồi": trước đây không đánh dấu gì, khiến người duyệt DUY NHẤT của 1 bước từng duyệt ở
    // vòng cũ bị chặn "đã xử lý bước này rồi" khi thử duyệt lại nội dung đã sửa, kẹt hồ sơ vĩnh viễn.
    item[historyField].forEach(h => { if (h.action === 'APPROVED') h.invalidated = true; });
    item[historyField].push({ step: currentStep, approver: user.name, username: user.username, action: 'REQUEST_CHANGES', comment, time: nowVN() });
    item[statusField] = 'DRAFT';
    item[currentStepField] = 0;
    // carRegs RIÊNG: "Phần Dành Cho Phòng Hành Chính" (xe/biển số/lái xe) chỉ được gán trong lúc DUYỆT
    // (xem extraFields ở applyWorkflowAction bên dưới). Đưa phiếu về NHÁP mà GIỮ NGUYÊN phần phân công
    // này để lại 2 hậu quả thật:
    //   1. findCarPlateConflict() (ở đầu file) bỏ qua phiếu REJECTED/CANCELLED nhưng KHÔNG bỏ qua DRAFT,
    //      nên chiếc xe vẫn bị coi là "đã bận" đúng khung giờ cũ của 1 phiếu đang chờ người tạo sửa lại
    //      (có thể sửa luôn cả giờ đi) — phiếu khác xin đúng xe/khung giờ đó bị chặn oan cho tới khi
    //      phiếu nháp này được gửi lại và duyệt xong, hoặc mãi mãi nếu người tạo bỏ luôn;
    //   2. phần phân công cũ (biển số + lái xe + đã xác nhận chuyến) vẫn hiển thị trên phiếu NHÁP như
    //      thể đã được duyệt, trong khi vòng duyệt đã bị huỷ và người điều hành xe sẽ phân công lại từ
    //      đầu ở vòng sau.
    // Trả về đúng trạng thái "chưa phân công" của 1 phiếu mới tạo (createValidation.js không hề gán các
    // field này) — dùng '' cho các field text để findCarPlateConflict() không bao giờ khớp nhầm.
    if (moduleKey === 'carRegs') {
      item.assignedPlate = '';
      item.assignedVehicleType = '';
      item.assignedTaxiCompany = '';
      item.assignedDriverUsername = '';
      item.assignedDriver = '';
      item.driverConfirmed = false;
      item.driverConfirmedAt = null;
    }
    return { item, transition: { type: 'REQUEST_CHANGES' } };
  }

  // PROPOSE_FILE_REPLACEMENT — chỉ Văn Bản Trình, chỉ người duyệt ở ĐÚNG bước của 1 nhóm được admin bật
  // cờ "Cho phép đề xuất thay thế file" (allowFileReplacementProposal, xem defaults.js
  // submissionApprovalGroups — đợt "Nhóm Phê Duyệt Trình tự cấu hình" 10/2026, TRƯỚC ĐÂY hardcode cố
  // định riêng cho khoá "TRO_LY_THU_KY"/"Bộ Phận Trợ Lý/Thư Ký", nay là CỜ admin gán được cho nhóm bất
  // kỳ — mặc định chỉ bật cho nhóm đó để giữ nguyên hành vi cũ): thay vì đưa thẳng về NHÁP như
  // REQUEST_CHANGES, đề xuất 1 tệp thay thế hoàn toàn nội dung tờ trình cũ và CHỜ người trình xác nhận
  // (RESOLVE_FILE_PROPOSAL bên dưới) — hồ sơ vẫn PENDING ở bước hiện tại, KHÔNG đổi status/currentStep
  // ngay (khác REQUEST_CHANGES) — đúng yêu cầu nghiệp vụ: nút "Yêu Cầu Bổ Sung" ở nhóm được cấp cờ này
  // có thêm lựa chọn thay vì luôn là REQUEST_CHANGES.
  if (action === 'PROPOSE_FILE_REPLACEMENT') {
    if (moduleKey !== 'submissions') throw new WorkflowError(400, 'Chỉ áp dụng cho Văn Bản Trình');
    const layerKey = steps[currentStep - 1]?.layerKey;
    const layerGroup = (appData?.submissionApprovalGroups || []).find(g => g.id === layerKey);
    // v15.8 — mở rộng thêm cho ĐÚNG bước phê duyệt CUỐI CÙNG của quy trình (currentStep === steps.length),
    // bất kể nhóm nào (TGD/PTGD/GD_PGD tuỳ mức "Cấp Phê Duyệt Cuối Cùng" người trình chọn) — TRƯỚC ĐÂY
    // chỉ đúng nhóm được cấp cờ mới có lựa chọn này, nhưng nhóm đó KHÔNG PHẢI LÚC NÀO cũng là bước cuối
    // (với mức "Tổng giám đốc phê duyệt", nhóm "Bộ Phận Trợ Lý/Thư Ký" mặc định luôn đứng NGAY TRƯỚC
    // bước TGD — bước cuối thật sự vẫn là TGD). Giữ NGUYÊN 100% hành vi cũ, chỉ THÊM điều kiện OR cho
    // bước cuối cùng.
    const isFinalStep = currentStep === steps.length;
    if (!layerGroup?.allowFileReplacementProposal && !isFinalStep) {
      throw new WorkflowError(403, 'Chỉ bước được cấp quyền "Đề xuất thay thế file" hoặc bước phê duyệt cuối cùng mới có thể đề xuất thay thế tệp tờ trình');
    }
    if (!canApproveStep(user, currentStepApprovers, item[historyField], currentStep)) {
      throw new WorkflowError(403, 'Bạn không có quyền xử lý ở bước hiện tại, hoặc đã xử lý bước này rồi');
    }
    assertNotSelfDecidingWorkflowItem(moduleKey, item, user);
    const { fileUrl, fileName, fileType } = extraFields || {};
    if (!fileUrl || !fileName) throw new WorkflowError(400, 'Thiếu tệp thay thế tờ trình');
    // Tệp thay thế đi thẳng vào item.fileUrl khi người trình đồng ý (RESOLVE_FILE_PROPOSAL bên dưới),
    // nên phải qua ĐÚNG lớp kiểm khuôn như mọi đường ghi fileUrl khác — xem assertUploadedFileUrl()
    // ở lib/createValidation.js (dùng lại nguyên hàm đó, không chép lại regex).
    assertUploadedFileUrl(fileUrl, 'Tệp thay thế tờ trình');
    item.pendingFileProposal = {
      fileUrl, fileName, fileType: fileType || '',
      note: comment || '',
      proposedBy: user.username, proposedByName: user.name,
      proposedAt: nowVN(), step: currentStep
    };
    // fileName/fileUrl ghi CẢ vào dòng lịch sử (không chỉ pendingFileProposal — trường này sẽ bị xoá
    // ngay khi người trình xác nhận xong) để tra cứu lại sau này vẫn biết ĐÚNG tệp nào đã được đề xuất
    // tại mốc này, khớp quy ước "field phụ ghi kèm dòng lịch sử" đã dùng cho CarReg (assignedDriver/
    // assignedPlate) ở applyWorkflowAction() bên dưới.
    item[historyField].push({ step: currentStep, approver: user.name, username: user.username, action: 'PROPOSE_FILE_REPLACEMENT', comment: comment || '', time: nowVN(), fileName, fileUrl });
    return { item, transition: { type: 'PROPOSE_FILE_REPLACEMENT' } };
  }

  // RESOLVE_FILE_PROPOSAL — người trình (item.creator) xác nhận đề xuất thay thế tệp ở trên: Đồng ý
  // (bắt buộc nêu lý do) -> áp tệp mới, GỬI LẠI TỪ BƯỚC 1 (giữ PENDING, không cần qua NHÁP vì người
  // trình không tự sửa gì thêm); Không đồng ý -> xử lý giống hệt REQUEST_CHANGES thường (về NHÁP để
  // người trình tự tải tệp thay thế khác qua openBosungEditModal() hiện có).
  if (action === 'RESOLVE_FILE_PROPOSAL') {
    if (moduleKey !== 'submissions') throw new WorkflowError(400, 'Chỉ áp dụng cho Văn Bản Trình');
    if (item.creator !== user.username) throw new WorkflowError(403, 'Chỉ người trình mới được xác nhận đề xuất thay thế tờ trình này');
    const proposal = item.pendingFileProposal;
    if (!proposal) throw new WorkflowError(409, 'Tờ trình này không có đề xuất thay thế nào đang chờ xác nhận');
    const agree = !!(extraFields || {}).agree;
    item[historyField].forEach(h => { if (h.action === 'APPROVED') h.invalidated = true; });
    if (agree) {
      if (!comment) throw new WorkflowError(400, 'Vui lòng nhập lý do đồng ý thay thế tờ trình');
      item.fileUrl = proposal.fileUrl;
      item.fileName = proposal.fileName;
      item.fileType = proposal.fileType || '';
      item[historyField].push({ step: proposal.step, approver: user.name, username: user.username, action: 'FILE_PROPOSAL_ACCEPTED', comment, time: nowVN(), fileName: proposal.fileName, fileUrl: proposal.fileUrl });
      item[statusField] = 'PENDING';
      item[currentStepField] = 1;
    } else {
      item[historyField].push({ step: proposal.step, approver: user.name, username: user.username, action: 'FILE_PROPOSAL_DECLINED', comment: comment || '', time: nowVN(), fileName: proposal.fileName, fileUrl: proposal.fileUrl });
      item[statusField] = 'DRAFT';
      item[currentStepField] = 0;
    }
    item.pendingFileProposal = null;
    return { item, transition: { type: 'RESOLVE_FILE_PROPOSAL', agree } };
  }

  if (action !== 'APPROVE' && action !== 'REJECT') throw new WorkflowError(400, `Hành động không hợp lệ: ${action}`);
  // paymentRequests (và bất kỳ module ẢO nào sau này khai disallowReject) — CHỈ hỗ trợ Duyệt, không có
  // khái niệm Từ chối hẳn qua engine này (xem chú thích ở MODULE_CONFIGS.paymentRequests phía trên).
  if (action === 'REJECT' && config.disallowReject) {
    throw new WorkflowError(400, 'Module này không hỗ trợ từ chối qua bước duyệt này');
  }
  if (action === 'REJECT' && !comment) throw new WorkflowError(400, 'Vui lòng nhập lý do từ chối');
  if (!canApproveStep(user, currentStepApprovers, item[historyField], currentStep)) {
    throw new WorkflowError(403, 'Bạn không có quyền xử lý ở bước hiện tại, hoặc đã xử lý bước này rồi');
  }
  assertNotSelfDecidingWorkflowItem(moduleKey, item, user);

  // Field phụ theo module (vd. CarReg: assignedDriver/assignedVehicleType/assignedPlate) — ghi cả
  // vào hồ sơ lẫn snapshot trong dòng lịch sử (khớp hiển thị "🚘 Phân công" theo từng bước ở client).
  // CarReg riêng: "Phần Dành Cho Phòng Hành Chính" (assignedDriverUsername/assignedVehicleType/
  // assignedPlate) CHỈ được ghi khi người duyệt là admin hoặc có perms.carDispatch ("Người Điều Hành
  // Xe") — người khác trong luồng duyệt vẫn Duyệt/Từ chối bình thường (canApproveStep ở trên đã cho
  // qua), nhưng KHÔNG được đụng tới 3 field này. Client đã tự ẩn mục này với người không có carDispatch
  // (xem openCarProcessModal() ở index.html) — chặn lại ở đây để không tin client tự gửi kèm dù giao
  // diện đã ẩn (vd DevTools sửa request tay): coi input carRegs.extraFields NHƯ KHÔNG CÓ, không lỗi cả
  // lượt duyệt (người này vẫn cần duyệt được bước của mình dù không có quyền điều hành xe).
  const isCarDispatcher = !!(user.perms?.admin || user.perms?.carDispatch);
  if (moduleKey === 'carRegs' && !isCarDispatcher) extraFields = undefined;

  const extraSnapshot = {};
  if (config.extraFields) {
    // Trim biển số ngay tại nguồn (đồng bộ với routes/workflow.js/reassignCarDispatch() — xem chú thích ở
    // đó) trước khi dùng cho kiểm tra trùng LẪN lưu vào item.assignedPlate qua vòng lặp config.extraFields
    // bên dưới, để không lệch giá trị đã trim dùng để khoá race với giá trị thật sự được lưu.
    if (moduleKey === 'carRegs' && extraFields && typeof extraFields.assignedPlate === 'string') {
      extraFields.assignedPlate = extraFields.assignedPlate.trim();
    }
    const newPlate = extraFields?.assignedPlate;
    if (moduleKey === 'carRegs' && newPlate && newPlate !== item.assignedPlate) {
      const conflict = findCarPlateConflict(existingCollection, item.id, newPlate, item.startTime, item.endTime);
      if (conflict) {
        throw new WorkflowError(409, `Biển số "${newPlate}" đã được gán cho phiếu "${conflict.code}" trùng khung giờ này`);
      }
    }
    // Lái xe PHẢI là 1 tài khoản hệ thống có thật (không cho gõ tên tự do nữa) — để đúng tài khoản đó
    // vào được sub-tab "Lái Xe" tự xác nhận chuyến của mình (xem confirmCarDriverAssignment() ở
    // lib/recordActions.js). Server tự tra display name từ user thay vì tin bất kỳ tên nào client gửi
    // kèm, tránh lệch giữa assignedDriverUsername (dùng để so quyền xác nhận) và assignedDriver (chỉ
    // hiển thị) — 2 trường trước đây độc lập nhau khi assignedDriver còn là ô text tự do.
    if (moduleKey === 'carRegs' && extraFields?.assignedDriverUsername) {
      const driverUser = (users || []).find(u => u.username === extraFields.assignedDriverUsername && u.active !== false);
      if (!driverUser) throw new WorkflowError(400, 'Không tìm thấy tài khoản lái xe này (hoặc đã bị khoá)');
      if (driverUser.username !== item.assignedDriverUsername) {
        const driverConflict = findCarDriverConflict(existingCollection, item.id, driverUser.username, item.startTime, item.endTime);
        if (driverConflict) {
          throw new WorkflowError(409, `Tài xế "${driverUser.name}" đã được phân công cho phiếu "${driverConflict.code}" trùng khung giờ này`);
        }
      }
      item.assignedDriverUsername = driverUser.username;
      item.assignedDriver = driverUser.name;
      extraSnapshot.assignedDriverUsername = driverUser.username;
      extraSnapshot.assignedDriver = driverUser.name;
      // Đổi sang lái xe khác -> hủy xác nhận cũ (nếu phiếu này trước đó đã được lái xe khác xác nhận) vì
      // trách nhiệm chuyến đi đã chuyển sang người khác, không thể giữ "đã xác nhận" hộ người cũ.
      if (item.driverConfirmed) {
        item.driverConfirmed = false;
        item.driverConfirmedAt = null;
      }
    }
    // Đổi "Loại xe cụ thể" sang Taxi/không-Taxi -> dọn field "đối lập" (BKS cố định vs Hãng Taxi) để
    // không để sót dữ liệu cũ (VD đổi từ "Xe 5 chỗ" -> "Xe Taxi" mà vẫn còn assignedPlate cũ treo lại,
    // dễ gây hiểu nhầm/khoá nhầm biển số cũ ở findCarPlateConflict() cho phiếu khác). Đặt TRƯỚC vòng lặp
    // extraFields bên dưới để field vừa chọn (nếu client có gửi kèm) vẫn được set lại đúng ngay sau đó.
    // Mục 3 (yêu cầu nghiệp vụ 9/2026): chuyển sang Taxi thì xe không còn thuộc đội xe công ty nữa —
    // XOÁ LUÔN tài xế đã gán (trước đây chỉ dọn biển số, để sót tài xế cũ treo lại dù xe giờ là taxi
    // ngoài — mirror ĐÚNG lỗ hổng vừa vá ở reassignCarDispatch()/lib/recordActions.js).
    if (moduleKey === 'carRegs' && extraFields?.assignedVehicleType && extraFields.assignedVehicleType !== item.assignedVehicleType) {
      const vehicleTypeList = Array.isArray(appData?.carVehicleTypes) ? appData.carVehicleTypes : [];
      const matchedType = vehicleTypeList.find(t => t.name === extraFields.assignedVehicleType);
      if (matchedType?.isTaxi) {
        item.assignedPlate = '';
        if (item.assignedDriverUsername || item.assignedDriver) {
          item.assignedDriverUsername = '';
          item.assignedDriver = '';
          extraSnapshot.assignedDriverUsername = '';
          extraSnapshot.assignedDriver = '';
          if (item.driverConfirmed) {
            item.driverConfirmed = false;
            item.driverConfirmedAt = null;
          }
        }
      } else {
        item.assignedTaxiCompany = '';
      }
    }
    for (const f of config.extraFields) {
      if (extraFields && extraFields[f]) {
        item[f] = extraFields[f];
        extraSnapshot[f] = extraFields[f];
      }
    }
  }

  if (action === 'REJECT') {
    item[statusField] = 'REJECTED';
    item[historyField].push({
      step: currentStep, stepName, approver: user.name, username: user.username,
      action: 'REJECTED', comment, time: nowVN(), ...extraSnapshot
    });
    return { item, transition: { type: 'REJECTED' } };
  }

  // APPROVE
  // canApproveStep()/isStepApprovalComplete() (đầu file, PHẢI giữ y hệt bản index.html nên không sửa
  // trực tiếp) cho admin bấm Duyệt bỏ qua điều kiện "đủ hết các approver được đặt tên ở bước" — cố ý,
  // dùng làm lối thoát khi 1 approver bị khoá tài khoản giữa chừng. Nhưng history entry ghi ra trước
  // đây KHÔNG phân biệt được "admin chính là approver hợp lệ cuối cùng của bước" (duyệt bình thường)
  // với "admin bỏ qua vì các approver khác CHƯA duyệt đủ" (ghi đè quy trình nhiều người ký) — 2 lượt
  // duyệt trông giống hệt nhau trên lịch sử, không có dấu hiệu nào cho biết bước 2-3 người ký đã bị bỏ
  // qua. Tính lại NGAY TRƯỚC KHI push entry mới (approvedBeforeThis chưa gồm lượt duyệt này) để biết
  // đây có phải override hay không, gắn cờ adminOverride:true vào đúng entry đó nếu có.
  // AUDIT (rà soát chuyên sâu luồng nghiệp vụ): công thức gốc coi TOÀN BỘ approversListForOverrideCheck
  // (kể cả chính username admin đang thao tác) đều phải có mặt trong approvedBeforeThis (lịch sử TRƯỚC
  // lượt duyệt này) mới coi là "không override" — nhưng admin không thể nào "đã tự duyệt trước chính
  // hành động đang thực hiện", nên bất kỳ khi nào admin được đặt tên là 1 trong các approver của bước
  // (cấu hình hợp lệ, không phải bypass), điều kiện NÀY LUÔN sai -> mọi lượt admin duyệt (kể cả chữ ký
  // CUỐI CÙNG hợp lệ sau khi mọi approver khác đã ký đủ) đều bị gắn nhầm adminOverride:true, ngược hẳn
  // với chính mục đích đã nêu ở comment trên. Sửa: chỉ xét những approver KHÁC (loại bỏ username của
  // chính admin đang duyệt) có đủ người đã ký trước đó hay chưa — đây mới đúng câu hỏi "có ai khác lẽ ra
  // phải ký mà bị admin bỏ qua không", không phải "chính admin đã ký trước đó chưa" (luôn là chưa).
  const approversListForOverrideCheck = normalizeApproversList(currentStepApprovers);
  const approvedBeforeThis = getStepApprovedUsernames(item[historyField], currentStep);
  const otherApproversRequired = approversListForOverrideCheck.filter(u => u !== user.username);
  const isAdminOverride = !!user.perms?.admin
    && !otherApproversRequired.every(u => approvedBeforeThis.has(u));

  item[historyField].push({
    step: currentStep, stepName, approver: user.name, username: user.username,
    action: 'APPROVED', comment, time: nowVN(), ...extraSnapshot,
    ...(isAdminOverride ? { adminOverride: true } : {})
  });

  if (!isStepApprovalComplete(user, currentStepApprovers, item[historyField], currentStep)) {
    return { item, transition: { type: 'PARTIAL_APPROVE', stepApprovers: currentStepApprovers } };
  }

  if (currentStep < steps.length) {
    item[currentStepField] = currentStep + 1;
    item[statusField] = 'PENDING';
    const nextApprovers = approvers?.[item[currentStepField]] || [];
    return {
      item,
      transition: {
        type: 'ADVANCED', stepApprovers: currentStepApprovers,
        nextStep: item[currentStepField], nextStepName: steps[item[currentStepField] - 1]?.name || '',
        nextApprovers
      }
    };
  }

  item[statusField] = 'APPROVED';
  // officeReqs (Mua Bán/Sửa Chữa/Đầu Tư, sub-module "Tổng Hợp") duyệt xong bước cuối -> mặc định
  // "Chưa thanh toán", khớp đúng paymentStatus gán ở lib/createValidation.js cho hợp đồng — cùng 1 mô
  // hình thanh toán, chỉ officeReqs mới cần field này (docs/submissions/carRegs không có luồng thanh
  // toán, không gán để tránh field thừa; hợp đồng đã tự gán paymentStatus lúc TẠO hồ sơ, xem
  // lib/createValidation.js, không cần gán lại ở đây cho cả 2 module key contracts/contractsSignedFile).
  if (moduleKey === 'officeReqs') item.paymentStatus = 'CHUA_THANH_TOAN';
  // itPriceApprovals: chụp lại ĐÚNG tệp giá đang là mới nhất tại thời điểm duyệt xong bước cuối —
  // KHÔNG thể suy ra "tệp đã duyệt" bằng cách lấy phần tử cuối của item.files[] về sau, vì IT vẫn có thể
  // tiếp tục yêu cầu bổ sung SAU KHI đã duyệt (trước lúc áp giá thật, xem requestPriceInfoFromIt() ở
  // lib/recordActions.js) khiến files[] phình thêm — phải chốt id ngay tại đây mới chính xác tuyệt đối.
  if (moduleKey === 'itPriceApprovals' && Array.isArray(item.files) && item.files.length) {
    item.approvedFileId = item.files[item.files.length - 1].id;
  }
  // operationOrders (đợt "Báo Cáo + Nhập Hàng") — duyệt xong bước cuối KHÔNG dừng ở APPROVED như mọi
  // module khác nữa: tự động sang thêm 1 giai đoạn "Chờ nhập hàng" (AWAITING_RECEIPT) để chờ người phụ
  // trách xác nhận NHẬP HÀNG (RECEIVED, "kết thúc" đơn) hoặc HỦY NHẬP (RECEIPT_CANCELLED, hàng không về
  // thực tế) — 2 hành động MỚI này đi qua route riêng POST /api/records/operationOrders/:id/receive-goods
  // |cancel-receipt (routes/records.js + lib/recordActions.js receiveOperationOrderGoods()/
  // cancelOperationOrderReceipt()), KHÔNG qua applyWorkflowAction() này (chỉ nhận PENDING ở đầu hàm,
  // xem dòng ~339) — giữ ĐÚNG quy trình duyệt phòng ban cũ nguyên vẹn, đây chỉ là 1 giai đoạn TIẾP THEO
  // sau khi đã duyệt xong. approvedAt (ISO, khác history[].time dạng vi-VN không tiện sort/group) ghi lại
  // đúng thời điểm này — dùng để nhóm "Giá trị đã duyệt theo tháng" ở tab Báo Cáo (module-vanhanh.js
  // renderOperationOrderReport()) mà không phải tự parse ngược history mỗi lần vẽ báo cáo. Hồ sơ CŨ đã ở
  // APPROVED TRƯỚC đợt này được di trú 1 lần sang AWAITING_RECEIPT bởi
  // migrateApprovedOperationOrdersToAwaitingReceipt() (seedDefaults.js) — xem chú thích ở đó.
  if (moduleKey === 'operationOrders') {
    item.status = 'AWAITING_RECEIPT';
    item.approvedAt = new Date().toISOString();
  }
  // paymentRequests — giữ lại đúng 3 field approvedBy/approvedByName/approvedAt mà approvePaymentRequest()
  // (quyền phẳng CŨ, đã bị xoá khỏi lib/recordActions.js) từng gán, vì client vẫn đọc lại chúng ở "Đã xử
  // lý" của Hộp Thư Duyệt Tổng Hợp (core-approvalhub.js: pr.approvedBy === user.username). Trong chuỗi
  // nhiều bước, đây là người duyệt bước CUỐI (người hoàn tất toàn bộ chuỗi) — cùng ý nghĩa "người duyệt
  // xong" như các module 1 bước khác.
  if (moduleKey === 'paymentRequests') {
    item.approvedBy = user.username;
    item.approvedByName = user.name;
    item.approvedAt = nowVN();
  }
  return { item, transition: { type: 'COMPLETED' } };
}

// Danh sách người duyệt THẬT đã resolve của ĐÚNG 1 bước, theo cùng cấu hình mà applyWorkflowAction()
// dùng (config.resolveWfConfig của module đó) — dùng để kiểm TRƯỚC "bước này có ai duyệt được không"
// mà không phải thực hiện hành động nào. Hiện dùng ở submitPaymentRequest() (lib/recordActions.js) để
// chặn gửi đề nghị vào ngõ cụt khi paymentDeptWorkflows của phòng ban chưa được admin cấu hình.
function resolveWorkflowStepApprovers(moduleKey, item, appData, step) {
  const config = MODULE_CONFIGS[moduleKey];
  if (!config) return [];
  const { approvers } = config.resolveWfConfig(item, appData || {});
  return approvers?.[step] || [];
}

module.exports = {
  MODULE_CONFIGS,
  resolveWorkflowStepApprovers,
  WorkflowError,
  applyWorkflowAction,
  assertNotSelfDecidingWorkflowItem,
  canApproveStep,
  isStepApprovalComplete,
  resolveStepApproverUsernames,
  flatWorkflowConfigToSteps,
  resolveSubmissionWorkflow,
  resolveContractApprovalWorkflow,
  resolveContractManageWorkflow,
  resolveItPriceDeptWorkflowConfig,
  resolveItPriceTierWorkflowConfig,
  resolveOperationOrderWorkflow,
  resolveOperationOrderStoreMixedApprovers,
  findCarPlateConflict,
  findCarDriverConflict,
  computeOperationOrderAmount,
  computeOperationOrderTier,
  OPERATION_ORDER_STORE_TIERS,
  OPERATION_ORDER_HO_TIERS
};
