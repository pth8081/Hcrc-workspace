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

const { MODULE_CONFIGS, canApproveStep } = require('./workflowEngine');
const {
  canApproveInternalPost, canApproveLicense, canManagePaymentRequests,
  canApproveItPriceEmergencyReject, isApproverForOperationOrderReceipt
} = require('./recordActions');

// canApproveMeeting(user) — KHÔNG có sẵn hàm export nào ở server (routes/meetingActions.js chỉ viết
// inline `!!(freshUser.perms?.admin || freshUser.perms?.meetingApprove)`, không tách hàm riêng) — PHẢI
// giữ giống hệt CẢ 2 nơi đó lẫn canApproveMeeting() client (public/js/core.js, ~dòng 2171).
function canApproveMeeting(user) {
  if (!user) return false;
  if (user.perms?.admin) return true;
  return !!user.perms?.meetingApprove;
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
  pushDeptWorkflowKeys(keys, 'budgetEntries', appData.budgetEntries, appData, user, 'budget');
  // Hợp đồng — 2 quy trình TÁCH RIÊNG trên CÙNG 1 bản ghi (contracts:approvalStatus + contractsSigned:
  // signedFileStatus), y hệt 2 lời gọi addDeptWorkflowItems() ở client.
  const contractsNonAddendum = (appData.contracts || []).filter(c => !c.isAddendum);
  pushDeptWorkflowKeys(keys, 'contracts', contractsNonAddendum, appData, user, 'contract');
  pushDeptWorkflowKeys(keys, 'contractsSignedFile', contractsNonAddendum, appData, user, 'contractSigned');
  pushDeptWorkflowKeys(keys, 'operationOrders', appData.operationOrders, appData, user, 'operationOrder');
  // operationStoreOpeningEstimate/operationRepairEstimate ĐÃ XOÁ khỏi MODULE_CONFIGS (lib/workflowEngine.js)
  // — chủ ứng dụng xác nhận Vận Hành > Siêu Thị KHÔNG có bước phê duyệt nào cả, kể cả Dự toán. Khớp việc xoá
  // 2 lời gọi addDeptWorkflowItems() tương ứng ở getMyPendingApprovals() (core-approvalhub.js).

  // ----- 2) Module theo 1 QUYỀN PHẲNG, không có khái niệm bước -----
  if (canApproveMeeting(user)) {
    (appData.meetings || []).filter(m => m.status === 'PENDING').forEach(m => keys.push(`meeting:${m.id}`));
  }
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
  if (canManagePaymentRequests(user)) {
    (appData.paymentRequests || []).filter(pr => pr.status === 'PENDING' || pr.status === 'NEED_INFO')
      .forEach(pr => keys.push(`payment:${pr.id}`));
  }
  // "Từ chối khẩn cấp" (Phê Duyệt Giá) — quyền phẳng itPriceEmergencyRejectApprove, KHÔNG đi qua bước
  // duyệt theo phòng ban (khớp requestItPriceEmergencyReject() ở lib/recordActions.js).
  if (canApproveItPriceEmergencyReject(user)) {
    (appData.itPriceApprovals || []).filter(p => p.emergencyRejectStatus === 'PENDING')
      .forEach(p => keys.push(`itPriceEmergencyReject:${p.id}`));
  }
  // Đơn hàng đang "Chờ Nhập Hàng" (AWAITING_RECEIPT) — KHÔNG phải quyết định duyệt/từ chối nên không đi
  // qua pushDeptWorkflowKeys() (chỉ bắt status==='PENDING'), quyền dùng ĐÚNG
  // isApproverForOperationOrderReceipt() (lib/recordActions.js — hàm này đã tự bao gồm nhánh
  // user.perms?.admin bên trong, không cần kiểm lại ở đây).
  (appData.operationOrders || []).forEach(o => {
    if (o.status === 'AWAITING_RECEIPT' && isApproverForOperationOrderReceipt(user, o, appData)) {
      keys.push(`operationOrderReceipt:${o.id}`);
    }
  });

  return [...new Set(keys)].sort();
}

module.exports = { computeMyPendingApprovalKeys };
