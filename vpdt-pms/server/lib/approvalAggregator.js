// lib/approvalAggregator.js — SERVER mirror của public/js/core-approvalhub.js::getMyPendingApprovals()
// (~dòng 50). BẢO TRÌ BẮT BUỘC: 2 hàm này PHẢI được sửa CÙNG NHAU — thêm/bớt 1 module ở BÊN NÀO cũng
// phải soát lại bên KIA ngay, nếu không "Approval Hub" (client, đọc DB.* đã tải sẵn) và endpoint polling
// mới (GET /api/approvals/pending-signature, dùng hàm ở đây) sẽ lệch nhau — vd polling báo "có hồ sơ
// mới" nhưng Hub thật lại không đổi gì (hoặc ngược lại, im lặng bỏ sót 1 module mới). Không tự suy diễn
// lại logic quyền ở đây — TÁI SỬ DỤNG chính các hàm/MODULE_CONFIGS server ĐANG DÙNG để enforce thật cho
// từng module (lib/workflowEngine.js MODULE_CONFIGS + canApproveStep(), lib/recordActions.js
// canApproveInternalPost/canApproveLicense/canManagePaymentRequests/canApproveItPriceEmergencyReject/
// isApproverForOperationOrderReceipt) — nên hàm ở đây KHÔNG THỂ tự lệch khỏi hành vi duyệt/từ chối thật,
// chỉ có thể lệch khỏi hình ảnh Hub bên client nếu ai đó quên cập nhật 1 trong 2 nơi khi thêm module mới.
//
// computeMyPendingApprovalKeys(user, appData) là HÀM THUẦN (không tự đọc DB) — CALLER (routes/
// approvals.js) chịu trách nhiệm dựng `appData` (gộp getAllAppDataWithVersionsCached() cho các map cấu
// hình quy trình + getAllForCollectionCached() cho từng collection hồ sơ ĐÃ chuyển sang dbo.Records, xem
// lib/recordStore.js MIGRATED_COLLECTIONS) đúng hình dạng mà MODULE_CONFIGS.*.resolveWfConfig() cần —
// same shape as GET /api/data (routes/data.js) tự dựng trước khi lọc quyền XEM (view scope, KHÁC quyền
// DUYỆT ở đây — cố tình dùng dữ liệu THÔ, chưa lọc theo view scope, vì filter-theo-người-duyệt của hàm
// này tự đủ chặt, không cần lớp filter view scope chồng lên).
//
// Trả về 1 mảng string "khoá" ĐÃ SẮP XẾP, DUY NHẤT, 1 khoá/hồ sơ đang PENDING và user được duyệt NGAY —
// KHÔNG trả về đếm-số-lượng: 1 hồ sơ được xử lý xong đúng lúc 1 hồ sơ khác mới phát sinh trong cùng 1
// nhịp poll có thể giữ NGUYÊN số lượng nhưng đổi hẳn NỘI DUNG — polling phía client (core.js
// startApprovalPolling()) cần phát hiện đúng trường hợp này nên phải so KHOÁ, không so ĐẾM.

const { MODULE_CONFIGS, canApproveStep, assertNotSelfDecidingWorkflowItem } = require('./workflowEngine');
const {
  canApproveInternalPost, canApproveLicense, canManagePaymentRequests,
  canApproveItPriceEmergencyReject, isApproverForOperationOrderReceipt,
  canApproveUniform, canApproveUniformTransfer, canDecideMeeting,
  assertNotSelfDecidingUniformPeriod, assertNotSelfDecidingUniformTransfer
} = require('./recordActions');
const { canApproveLeaveRequest, assertShiftSwapApprover } = require('./attendance');

// resolveEmployeeUsername() — bản copy nhỏ của lib/recordViewScope.js (cùng tên, không export sẵn ở đó)
// — thuần tra cứu dữ liệu (employeeCode -> username qua employeeProfiles), KHÔNG phải quyết định quyền
// nên không vi phạm nguyên tắc "không tự suy diễn lại logic quyền" ở đầu file.
function resolveEmployeeUsername(employeeCode, employeeProfiles) {
  const profile = (employeeProfiles || []).find(p => p.employeeCode === employeeCode);
  return profile?.username || null;
}

// Mirror addDeptWorkflowItems() (core-approvalhub.js, ~dòng 58) cho ĐÚNG 1 module: đẩy "<keyPrefix>:<id>"
// cho mỗi bản ghi trong `records` đang PENDING (field tên theo config.statusField, mặc định 'status') VÀ
// `user` được duyệt NGAY ở bước hiện tại — canApproveStep() ở đây là ĐÚNG hàm mà
// lib/workflowEngine.js::applyWorkflowAction() dùng để gác lượt ghi Duyệt/Từ chối thật, không phải bản
// suy diễn lại.
function pushDeptWorkflowKeys(keys, moduleKey, records, appData, user, keyPrefix) {
  const config = MODULE_CONFIGS[moduleKey];
  /* istanbul ignore next -- lập trình sai (gõ nhầm tên module), không phải lỗi vận hành thật */
  if (!config) throw new Error(`computeMyPendingApprovalKeys: module không tồn tại trong MODULE_CONFIGS: ${moduleKey}`);
  const statusField = config.statusField || 'status';
  const currentStepField = config.currentStepField || 'currentStep';
  const historyField = config.historyField || 'history';
  (records || []).forEach(rec => {
    if (rec[statusField] !== 'PENDING') return;
    const wfConfig = config.resolveWfConfig(rec, appData) || {};
    const step = rec[currentStepField];
    const currentStepApprovers = wfConfig.approvers ? (wfConfig.approvers[step] || []) : [];
    if (!canApproveStep(user, currentStepApprovers, rec[historyField], step)) return;
    // LỖI ĐÃ VÁ (re-audit lần 6, mức TB — "approvalAggregator pushDeptWorkflowKeys thiếu check tự
    // duyệt"): canApproveStep() ở trên chỉ là NỬA điều kiện enforcement thật (applyWorkflowAction() ở
    // lib/workflowEngine.js luôn gọi CẢ canApproveStep() LẪN assertNotSelfDecidingWorkflowItem() trước
    // khi cho ghi Duyệt/Từ chối — xem các dòng gọi ở applyWorkflowAction()). Thiếu nửa sau ở đây khiến
    // Approval Hub/endpoint polling báo "có hồ sơ cần duyệt" cho ĐÚNG người đã tạo/trình hồ sơ đó (nếu
    // họ tình cờ cũng nằm trong danh sách approver bước hiện tại) — bấm Duyệt thật sẽ nhận 403 "không
    // thể tự xử lý" dù Hub vừa báo có việc, một thông báo giả. Bắt exception (không phải throw ra
    // ngoài) rồi BỎ QUA record đó — đúng ngữ nghĩa "ẩn khỏi danh sách cần duyệt", không phải lỗi.
    try { assertNotSelfDecidingWorkflowItem(moduleKey, rec, user); } catch (err) { return; }
    keys.push(`${keyPrefix}:${rec.id}`);
  });
}

function computeMyPendingApprovalKeys(user, appData) {
  if (!user) return [];
  const keys = [];

  // ----- 1) Module theo BƯỚC quy trình phòng ban (canApproveStep qua MODULE_CONFIGS) — khớp từng lời
  // gọi addDeptWorkflowItems() tương ứng ở getMyPendingApprovals() (core-approvalhub.js) -----
  pushDeptWorkflowKeys(keys, 'docs', appData.docs, appData, user, 'doc');
  pushDeptWorkflowKeys(keys, 'submissions', appData.submissions, appData, user, 'submission');
  pushDeptWorkflowKeys(keys, 'carRegs', appData.carRegs, appData, user, 'car');
  // officeReqs: client TÁCH 2 lời gọi riêng theo subType (MUA_BAN/SUA_CHUA, "Đầu Tư"/DAU_TU đã bị xoá
  // hẳn khỏi module — xem chú thích OFFICE_SUBTYPE_TO_DBKEY ở lib/workflowEngine.js) dù cùng chạy qua
  // MODULE_CONFIGS.officeReqs — giữ tách y hệt ở đây (không gộp lại) để khoá "officeBuy:<id>"/
  // "officeFix:<id>" khớp đúng type client dùng, dễ đối chiếu khi soát lại 2 hàm.
  const officeBuyReqs = (appData.officeReqs || []).filter(o => o.subType === 'MUA_BAN');
  const officeFixReqs = (appData.officeReqs || []).filter(o => o.subType === 'SUA_CHUA');
  pushDeptWorkflowKeys(keys, 'officeReqs', officeBuyReqs, appData, user, 'officeBuy');
  pushDeptWorkflowKeys(keys, 'officeReqs', officeFixReqs, appData, user, 'officeFix');
  pushDeptWorkflowKeys(keys, 'vppRegistrations', appData.vppRegistrations, appData, user, 'vpp');
  pushDeptWorkflowKeys(keys, 'itPriceApprovals', appData.itPriceApprovals, appData, user, 'itPrice');
  // LỖI ĐÃ VÁ (re-audit lần 8, mức Thấp-TB — "approvalAggregator vẫn giữ budgetEntries đã bị gỡ khỏi
  // Approval Hub client"): mục "📊 Ngân Sách" (budgetEntries) đã bị BỎ HOÀN TOÀN khỏi
  // getMyPendingApprovals() (core-approvalhub.js, ~dòng 145) từ v23.0 khi module Ngân Sách được thiết kế
  // lại ("Ngân Sách 2.0" — không còn workflowEngine.js/dept-workflow nào cho Ngân Sách, chỉ còn 1 cấp gác
  // quyền phẳng budgetCreate/budgetManage; dòng mới budgetLines đã có nút Duyệt/Từ chối riêng ngay trong
  // module Ngân Sách, không cần qua Approval Hub). Lời gọi pushDeptWorkflowKeys('budgetEntries', ...) ở
  // đây KHÔNG được gỡ theo — mirror lệch khiến endpoint polling (GET /api/approvals/pending-signature)
  // vẫn báo "có hồ sơ cần duyệt" (khoá 'budget:<id>') cho dữ liệu budgetEntries LỊCH SỬ (không xoá,
  // GIỮ NGUYÊN ở server) dù Approval Hub không còn màn nào hiển thị/xử lý được nó — 1 thông báo giả vô
  // hại nhưng vô dụng. Gỡ bỏ lời gọi, khớp đúng client. budgetEntries vẫn còn trong appData ở nơi khác
  // (routes/records.js vẫn phục vụ submit/update/manager-edit cho dữ liệu lịch sử) — chỉ riêng mirror
  // Approval Hub này không còn cần đọc nó.
  // Hợp đồng — 2 quy trình TÁCH RIÊNG trên CÙNG 1 bản ghi (contracts:approvalStatus + contractsSigned:
  // signedFileStatus), y hệt 2 lời gọi addDeptWorkflowItems() ở client.
  const contractsNonAddendum = (appData.contracts || []).filter(c => !c.isAddendum);
  pushDeptWorkflowKeys(keys, 'contracts', contractsNonAddendum, appData, user, 'contract');
  pushDeptWorkflowKeys(keys, 'contractsSignedFile', contractsNonAddendum, appData, user, 'contractSigned');
  pushDeptWorkflowKeys(keys, 'operationOrders', appData.operationOrders, appData, user, 'operationOrder');
  // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026): paymentRequests PENDING trước đây chỉ đẩy khoá qua
  // cờ phẳng canManagePaymentRequests() (mục "2) Module theo 1 QUYỀN PHẲNG" bên dưới) — sai 2 chiều:
  // (a) approver được cấu hình RIÊNG theo bước ở paymentDeptWorkflows nhưng KHÔNG có cờ phẳng
  // paymentManage sẽ KHÔNG BAO GIỜ nhận được khoá "payment:<id>" (không có thông báo "hồ sơ mới cần
  // duyệt"); (b) ngược lại, ai có paymentManage sẽ nhận khoá cho MỌI đề nghị company-wide kể cả khi
  // KHÔNG được liệt kê ở đúng bước duyệt của phòng ban đó — bấm vào sẽ bị 403 (thông báo giả). Client
  // (public/js/core-approvalhub.js, dòng ~244-256) đã tách đúng từ trước: PENDING đi qua
  // addDeptWorkflowItems() (mirror pushDeptWorkflowKeys() ở đây), CHỈ NEED_INFO còn giữ nguyên cờ phẳng
  // canManagePaymentRequestsClient() (xem nhánh giữ nguyên bên dưới, mục 2) — nay đồng bộ lại server.
  pushDeptWorkflowKeys(keys, 'paymentRequests', appData.paymentRequests, appData, user, 'payment');
  // operationStoreOpeningEstimate/operationRepairEstimate ĐÃ XOÁ khỏi MODULE_CONFIGS (lib/workflowEngine.js)
  // — chủ ứng dụng xác nhận Vận Hành > Siêu Thị KHÔNG có bước phê duyệt nào cả, kể cả Dự toán. Khớp việc xoá
  // 2 lời gọi addDeptWorkflowItems() tương ứng ở getMyPendingApprovals() (core-approvalhub.js).

  // ----- 2) Module theo 1 QUYỀN PHẲNG, không có khái niệm bước -----
  // LỖI ĐÃ VÁ (re-audit lần 6, mức Cao — "approvalAggregator canApproveMeeting lỗi thời"): hàm cũ
  // canApproveMeeting(user) (đã XOÁ) chỉ kiểm `admin || meetingApprove` KHÔNG theo TỪNG hồ sơ — mirror
  // SAI/CŨ của canDecideMeeting() (lib/recordActions.js, hàm THẬT đang gác route "approve" ở
  // routes/meetingActions.js): (1) KHÔNG loại trừ chính người tạo lịch họp (self-approval) -> false
  // positive, người vừa tự đặt phòng họp của chính mình thấy ngay badge "Phê Duyệt (1)" dù bấm Duyệt sẽ
  // bị 403 thật; (2) KHÔNG tính nhánh meetingDeptWorkflows[dept] (admin gán RIÊNG người duyệt cho 1
  // phòng ban dù người đó KHÔNG có quyền phẳng meetingApprove) -> false negative, người được gán duyệt
  // riêng cho phòng ban mình không BAO GIỜ nhận được khoá "meeting:<id>" (không có thông báo hồ sơ mới
  // cần duyệt, phải tự F5/tự vào Hub mới thấy). Nay gọi THẲNG canDecideMeeting(user, m, appData) — ĐÚNG
  // hàm enforcement thật, cho TỪNG hồ sơ — khớp đúng triết lý "không tự suy diễn lại logic quyền" nêu ở
  // đầu file.
  (appData.meetings || []).filter(m => m.status === 'PENDING' && canDecideMeeting(user, m, appData))
    .forEach(m => keys.push(`meeting:${m.id}`));
  if (canApproveInternalPost(user)) {
    (appData.internalPosts || []).forEach(p => {
      if (p.type === 'SHARE' && p.status === 'PENDING') keys.push(`internalShare:${p.id}`);
      // Bình luận bị hệ thống tự đánh dấu nghi vấn (scanCommentForSensitiveContent()) — khớp khối
      // "flaggedComment" ở getMyPendingApprovals(), người kiểm duyệt cần biết NGAY dù không nằm trong
      // trạng thái PENDING của bài viết.
      (p.comments || []).forEach(c => {
        if (c.flagged) keys.push(`flaggedComment:${p.id}:${c.id}`);
      });
    });
  }
  if (canApproveLicense(user)) {
    (appData.licenses || []).filter(l => l.status === 'PENDING').forEach(l => keys.push(`license:${l.id}`));
  }
  // NEED_INFO (yêu cầu bổ sung, KHÔNG đi qua applyWorkflowAction()/pushDeptWorkflowKeys() — xem
  // lib/recordActions.js requestPaymentInfo()) giữ nguyên cờ phẳng canManagePaymentRequests(), khớp
  // đúng canManagePaymentRequestsClient() ở core-approvalhub.js — quyết định đã chốt với người dùng,
  // không đổi. PENDING đã chuyển sang pushDeptWorkflowKeys() ở mục 1) phía trên.
  if (canManagePaymentRequests(user)) {
    (appData.paymentRequests || []).filter(pr => pr.status === 'NEED_INFO')
      .forEach(pr => keys.push(`payment:${pr.id}`));
  }
  // "Từ chối khẩn cấp" (Phê Duyệt Giá) — quyền phẳng itPriceEmergencyRejectApproveWholesale/Retail
  // (10/2026 tách theo priceType), KHÔNG đi qua bước duyệt theo phòng ban (khớp
  // requestItPriceEmergencyReject() ở lib/recordActions.js) — kiểm tra TỪNG hồ sơ theo đúng priceType
  // của hồ sơ đó, không còn 1 cờ chung cho cả 2 loại như trước.
  (appData.itPriceApprovals || []).filter(p => p.emergencyRejectStatus === 'PENDING' && canApproveItPriceEmergencyReject(user, p.priceType))
    .forEach(p => keys.push(`itPriceEmergencyReject:${p.id}`));
  // Đơn hàng đang "Chờ Nhập Hàng" (AWAITING_RECEIPT) — KHÔNG phải quyết định duyệt/từ chối nên không đi
  // qua pushDeptWorkflowKeys() (chỉ bắt status==='PENDING'), quyền dùng ĐÚNG
  // isApproverForOperationOrderReceipt() (lib/recordActions.js — hàm này đã tự bao gồm nhánh
  // user.perms?.admin bên trong, không cần kiểm lại ở đây).
  (appData.operationOrders || []).forEach(o => {
    if (o.status === 'AWAITING_RECEIPT' && isApproverForOperationOrderReceipt(user, o, appData)) {
      keys.push(`operationOrderReceipt:${o.id}`);
    }
  });

  // LỖI ĐÃ VÁ (rà soát chuyên sâu lần 2 trước go-live, 11/2026, mức Cao): 5 luồng phê duyệt sau đây
  // (Đồng Phục/Nghỉ Phép/Đổi Ca/Huỷ Đăng Ký Đào Tạo/Gia Hạn-Huỷ Công Việc) chưa từng có khoá nào ở đây —
  // khớp đúng 5 khối mới thêm ở getMyPendingApprovals() (core-approvalhub.js): endpoint polling (GET
  // /api/approvals/pending-signature) trước đây KHÔNG BAO GIỜ phát hiện hồ sơ mới ở 5 luồng này, dù Hub
  // (sau khi vá) đã hiện đúng — nhãn "Phê Duyệt (N)" trên nav không tăng, poll không kích hoạt
  // initDatabase() làm mới Hub cho tới khi người dùng tự F5/tự chuyển qua màn Hub.
  // LỖI ĐÃ VÁ (re-audit lần 7, mức Thấp — "approvalAggregator 3 luồng mới (uniform/shiftSwap) thiếu
  // loại trừ tự-liên-quan"): 3 khối uniformPeriod/uniformTransfer/shiftSwapRequest ngay dưới trước đây
  // CHỈ kiểm quyền PHẲNG (canApproveUniform/canApproveUniformTransfer/allowed thủ công) — KHÔNG loại trừ
  // chính người tạo/yêu cầu như enforcement thật đã có từ lâu (assertNotSelfDecidingUniformPeriod()/
  // assertNotSelfDecidingUniformTransfer() ở approveUniformPeriod()/approveUniformTransfer() —
  // lib/recordActions.js; assertShiftSwapApprover() ở routes/shiftSwapRequests/:id/approve — nay đã dời
  // sang lib/attendance.js để tái dùng được ở đây). Hậu quả: người có uniformApprove/uniformManage tự
  // tạo kỳ cấp phát/điều chuyển của chính mình, hoặc người có hrShiftSwapApprove/hrAttendanceManage/admin
  // là chính bên tạo/nhận ca của 1 yêu cầu đổi ca, đều thấy khoá "cần duyệt" ở Approval Hub/endpoint
  // polling dù bấm Duyệt thật sẽ luôn bị 403 (server vẫn enforce đúng, không phải lỗ hổng bảo mật) — chỉ
  // là thông báo giả. Gọi THẲNG đúng hàm assert thật qua try/catch (cùng khuôn pushDeptWorkflowKeys() ở
  // trên) — khớp triết lý "không tự suy diễn lại logic quyền" nêu ở đầu file; với shiftSwapRequest, gọi
  // assertShiftSwapApprover() THAY HẲN cho việc tự tính lại biến `allowed` (hàm đã bao gồm đúng cả 2
  // nhánh loại trừ requester/target LẪN điều kiện quyền phẳng/dept, không cần tính riêng nữa).
  if (canApproveUniform(user)) {
    (appData.uniformPeriods || []).filter(p => p.approvalStatus === 'PENDING_APPROVAL').forEach(p => {
      try { assertNotSelfDecidingUniformPeriod(user, p); } catch (err) { return; }
      keys.push(`uniformPeriod:${p.id}`);
    });
  }
  if (canApproveUniformTransfer(user)) {
    (appData.uniformTransfers || []).filter(t => t.status === 'PENDING_APPROVAL').forEach(t => {
      try { assertNotSelfDecidingUniformTransfer(user, t); } catch (err) { return; }
      keys.push(`uniformTransfer:${t.id}`);
    });
  }
  (appData.leaveRequests || []).filter(r => r.status === 'PENDING').forEach(r => {
    const empUsername = resolveEmployeeUsername(r.employeeCode, appData.employeeProfiles);
    if (empUsername === user.username) return; // tự mình xin nghỉ, không tự duyệt được (khớp điều kiện client)
    if (canApproveLeaveRequest(user, appData.users, empUsername)) keys.push(`leaveRequest:${r.id}`);
  });
  // Đổi ca — mirror ĐÚNG assertShiftSwapApprover() (lib/attendance.js, routes/records.js tái dùng cho
  // chính route duyệt thật): hrShiftSwapApprove CHỈ duyệt được đúng siêu thị mình quản lý
  // (roster.storeCode === user.dept), chặt hơn điều kiện hiện nút Duyệt ở client (canApproveHacSwap() —
  // module-conghop.js, cố tình KHÔNG lọc theo siêu thị, xem chú thích ở getMyPendingApprovals()) — giữ
  // đúng enforcement thật ở đây để khoá polling không báo sai.
  (appData.shiftSwapRequests || []).filter(s => s.status === 'PENDING').forEach(s => {
    const roster = (appData.shiftRoster || []).find(r => r.id === s.requesterRosterId);
    const targetUsername = resolveEmployeeUsername(s.targetEmployeeCode, appData.employeeProfiles);
    try { assertShiftSwapApprover(user, roster, s.creator, targetUsername); } catch (err) { return; }
    keys.push(`shiftSwapRequest:${s.id}`);
  });
  if (user?.perms?.admin || user?.perms?.trainingManage) {
    (appData.trainingRegistrations || []).filter(r => r.pendingCancellation).forEach(r => keys.push(`trainingCancel:${r.id}`));
  }
  (appData.tasks || []).filter(t => (t.pendingExtension || t.pendingCancellation) && (t.assignedBy === user.username || user?.perms?.admin)).forEach(t => keys.push(`taskPending:${t.id}`));

  return [...new Set(keys)].sort();
}

module.exports = { computeMyPendingApprovalKeys };
