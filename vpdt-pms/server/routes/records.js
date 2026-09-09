// routes/records.js — Bước 2b (phương án C bảo mật): sửa/xóa/giao hồ sơ đã tồn tại (Hợp đồng, Biên
// bản họp, Công việc) đi qua đường có xác minh ở server (xem lib/recordActions.js), thay cho ghi thẳng
// toàn bộ mảng qua POST /api/data/:key như trước đây.
const express = require('express');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { HttpError } = require('../lib/httpErrors');
const recordActions = require('../lib/recordActions');
const employeeProfile = require('../lib/employeeProfile');
const laborContract = require('../lib/laborContract');
const attendance = require('../lib/attendance');
const { insertTask, withLockedTaskById, deleteTaskById, getAllTasks, migrateDirectiveTaskLinks } = require('../lib/taskStore');
const { getAllWorkItems, getWorkItemsBySource, insertWorkItem, withLockedWorkItemById, deleteWorkItemById, deleteWorkItemsByIds } = require('../lib/operationWorkItemStore');
const { createForCollection, insertRecord, withLockedRecordForCollection, withLockedRecordById, deleteRecordForCollection, getAllForCollection, withAppLock } = require('../lib/recordStore');
const { getAllAppData, getAppDataValue, withLockedAppDataValue } = require('../lib/appData');
// sanitizeInternalPostCommentsForUser: cùng hàm mà routes/data.js dùng để lọc GET /api/data (qua
// filterInternalPostsForUser) — MỌI response trả về bản ghi internalPosts đã mutate ở file này cũng
// PHẢI đi qua nó, xem chú thích ở withInternalPostAction() bên dưới.
const { sanitizeInternalPostCommentsForUser, canViewInternalPost } = require('../lib/recordViewScope');
router.use(requireAuth, blockIfMustChangePassword);

// requireAuth đã tự xác định lại CHÍNH XÁC người dùng hiện tại từ DB (kể cả trạng thái active) và gắn
// sẵn vào req.freshUser/req.allUsers — không cần đọc lại DB thêm 1 lần nữa cho cùng mục đích.
function getFreshUser(req) {
  return { freshUser: req.freshUser, users: req.allUsers };
}

function handleError(res, action, err) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(`POST /api/records/${action} lỗi:`, err.message);
  res.status(500).json({ error: 'Không thể xử lý yêu cầu' });
}

// POST /api/records/contracts/:id/edit — contracts đã chuyển sang bảng dbo.Records (Bước 6g, xem
// lib/recordStore.js), khoá đúng 1 dòng hợp đồng thay vì cả collection.
router.post('/contracts/:id/edit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const allContracts = await getAllForCollection('contracts');
    const hasAddenda = allContracts.some(c => c.isAddendum && c.rootContractId === itemId);
    const thisRecord = allContracts.find(c => c.id === itemId);
    const rootRecord = (thisRecord && thisRecord.isAddendum)
      ? allContracts.find(c => c.id === thisRecord.rootContractId)
      : undefined;
    const rootDept = rootRecord?.dept;
    const rootCustodianDept = rootRecord?.custodianDept;
    // AppData dùng cho 2 việc trong editContract(): dựng lại effectiveSteps/effectiveApprovers khi đổi
    // dept (chỉ hợp đồng gốc mới đổi được) VÀ đối chiếu trường bắt buộc của Biểu Mẫu (formTemplates) —
    // việc thứ 2 áp dụng cho CẢ phụ lục nên KHÔNG còn bỏ qua lượt đọc này khi isAddendum như trước.
    const appData = await getAllAppData();
    const result = await withLockedRecordForCollection('contracts', itemId, (item) =>
      recordActions.editContract(req.body, freshUser, item, hasAddenda, rootDept, appData, rootCustodianDept)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `contracts/${req.params.id}/edit`, err);
  }
});

// POST /api/records/contracts/:id/upload-signed — tải "Tài liệu ký" (xem lib/recordActions.js). Duyệt/
// từ chối hợp đồng gốc VÀ duyệt/từ chối Tài liệu ký giờ đều đi qua route generic
// POST /api/workflow/contracts/:id/approve|reject và POST /api/workflow/contractsSignedFile/:id/
// approve|reject (xem routes/workflow.js + lib/workflowEngine.js) — không còn 2 cặp route
// approve/reject riêng ở đây nữa (trước đây là flat-permission, không có khái niệm bước/phòng ban).
async function withContractAction(req, res, action, mutator) {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('contracts', itemId, (item) => mutator(req.body, freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `contracts/${req.params.id}/${action}`, err);
  }
}

router.post('/contracts/:id/upload-signed', (req, res) =>
  withContractAction(req, res, 'upload-signed', recordActions.uploadContractSignedFile));

// Đổi Hình Thức Thanh Toán sau khi hợp đồng đã APPROVED — qua phê duyệt lại bởi ĐÚNG nhóm người duyệt
// "Tài liệu ký" (contractManageDeptWorkflows[dept], xem isApproverForContractManageWorkflow() ở
// lib/recordActions.js). appData cần cho resolveContractManageWorkflow() (workflowEngine.js) tra cứu
// approvers theo dept + danh sách paymentRequests để chặn nếu hợp đồng đã có đề nghị thanh toán.
router.post('/contracts/:id/request-payment-type-change', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const [appData, allPaymentRequests] = await Promise.all([getAllAppData(), getAllForCollection('paymentRequests')]);
    const result = await withLockedRecordForCollection('contracts', itemId, (item) =>
      recordActions.requestContractPaymentTypeChange(freshUser, item, req.body, appData, allPaymentRequests));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `contracts/${req.params.id}/request-payment-type-change`, err);
  }
});

router.post('/contracts/:id/approve-payment-type-change', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const appData = await getAllAppData();
    const result = await withLockedRecordForCollection('contracts', itemId, (item) =>
      recordActions.approveContractPaymentTypeChange(freshUser, item, appData));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `contracts/${req.params.id}/approve-payment-type-change`, err);
  }
});

router.post('/contracts/:id/reject-payment-type-change', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const appData = await getAllAppData();
    const result = await withLockedRecordForCollection('contracts', itemId, (item) =>
      recordActions.rejectContractPaymentTypeChange(freshUser, item, req.body, appData));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `contracts/${req.params.id}/reject-payment-type-change`, err);
  }
});

// "Mỗi đợt tự đi hết quy trình riêng" (Thanh toán định kỳ/officeReqs/thủ công) — startContractPayment()/
// startOfficePayment() giờ có thể trả về 1 MẢNG bản ghi nháp (mỗi đợt 1 bản ghi riêng, cùng cycleGroupId,
// xem lib/recordActions.js splitPaymentDraftsByInstallment()) thay vì 1 object đơn (chỉ còn ONE_TIME giữ
// nguyên object đơn) — hàm dùng chung dưới đây tạo đủ N bản ghi, "id: Date.now() + i" tránh trùng id khi
// tạo nhiều bản ghi trong CÙNG 1 millisecond.
async function createPaymentRequestsFromDraft(draft) {
  const drafts = Array.isArray(draft) ? draft : [draft];
  const created = [];
  for (let i = 0; i < drafts.length; i++) {
    created.push(await createForCollection('paymentRequests', () => ({ ...drafts[i], id: Date.now() + i })));
  }
  return created;
}

// "Chuyển Sang Thanh Toán" KHÔNG dùng withContractAction() thường — mutatorFn trả về BẢN NHÁP đề nghị
// thanh toán (chưa lưu) thay vì bản ghi hợp đồng, PHẢI insert thêm vào collection paymentRequests
// ngay sau khi khoá hợp đồng nhả ra (cùng khuôn insertMinutesTasks() ở /minutes/:id/assign-tasks bên
// dưới) — 1 request duy nhất vừa cập nhật hợp đồng vừa sinh đề nghị thanh toán, không tách 2 lượt gọi
// API để tránh client tự ý bỏ qua bước tạo đề nghị.
router.post('/contracts/:id/start-payment', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    let draft = null;
    const result = await withLockedRecordForCollection('contracts', itemId, (item) => {
      draft = recordActions.startContractPayment(freshUser, item);
      return item;
    });
    const paymentRequests = await createPaymentRequestsFromDraft(draft);
    res.json({ ok: true, item: result, paymentRequest: paymentRequests[0], paymentRequests });
  } catch (err) {
    handleError(res, `contracts/${req.params.id}/start-payment`, err);
  }
});

// POST /api/records/officeReqs/:id/upload-signed + /start-payment — tải "Tài liệu ký" + chuyển đề xuất
// Mua Bán/Sửa Chữa/Đầu Tư (module "Tổng Hợp") đã duyệt xong sang "Chờ thanh toán" (xem
// lib/recordActions.js), cùng khuôn với contracts ở trên.
async function withOfficeReqAction(req, res, action, mutator) {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('officeReqs', itemId, (item) => mutator(req.body, freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `officeReqs/${req.params.id}/${action}`, err);
  }
}

router.post('/officeReqs/:id/upload-signed', (req, res) =>
  withOfficeReqAction(req, res, 'upload-signed', recordActions.uploadOfficeSignedFile));

router.post('/officeReqs/:id/start-payment', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    let draft = null;
    const result = await withLockedRecordForCollection('officeReqs', itemId, (item) => {
      draft = recordActions.startOfficePayment(freshUser, item);
      return item;
    });
    const paymentRequests = await createPaymentRequestsFromDraft(draft);
    res.json({ ok: true, item: result, paymentRequest: paymentRequests[0], paymentRequests });
  } catch (err) {
    handleError(res, `officeReqs/${req.params.id}/start-payment`, err);
  }
});

// POST /api/records/paymentRequests/from-source — kế toán (paymentManage) tự khởi tạo đề nghị thanh
// toán NGAY TỪ module Thanh Toán, chọn "Loại Đề Nghị" (Hợp Đồng/Mua Sắm/Sửa Chữa/Đầu Tư) + đúng bản ghi
// nguồn còn CHUA_THANH_TOAN, có thể sửa lại đợt thanh toán/tên tham khảo từ nguồn trước khi gửi (xem
// startContractPayment()/startOfficePayment() ở lib/recordActions.js, tham số overrides). Cùng khuôn
// atomic "khoá nguồn -> xác thực + gắn CHO_THANH_TOAN -> insert paymentRequests" như 2 route
// /contracts/:id/start-payment và /officeReqs/:id/start-payment ở trên — chỉ khác gác cổng: ở đây gác
// bằng paymentManage (kế toán không nhất thiết thuộc đơn vị custodian của nguồn), 2 route kia vẫn gác
// bằng canManageContractPayment()/canManageOfficePayment() (đúng đơn vị custodian) như cũ.
router.post('/paymentRequests/from-source', async (req, res) => {
  try {
    const { freshUser } = await getFreshUser(req);
    if (!recordActions.canManagePaymentRequests(freshUser)) {
      return res.status(403).json({ error: 'Bạn không có quyền tạo đề nghị thanh toán' });
    }
    const sourceModule = String(req.body?.sourceModule || '');
    const sourceId = Number(req.body?.sourceId);
    if (!Number.isFinite(sourceId)) return res.status(400).json({ error: 'sourceId không hợp lệ' });
    // LUÔN tạo NHÁP (xem startContractPayment()/startOfficePayment() ở lib/recordActions.js) — TRƯỚC ĐÂY
    // route này dùng overrides.createAsPending để tạo THẲNG PENDING, giờ BỎ HẲN: kế toán tự tạo đề nghị
    // có nguồn từ module Thanh Toán cũng phải qua "🗂️ Quản Lý Thanh Toán" đính kèm "Hồ Sơ Đề Nghị Thanh
    // Toán" (multi-file) rồi mới "Chuyển Xác Nhận Thanh Toán" được, cùng luật với mọi nguồn khác.
    const overrides = {
      title: req.body?.title,
      installments: req.body?.installments,
      requestFiles: req.body?.requestFiles,
      skipManageGate: true
    };

    let draft = null;
    let result;
    if (sourceModule === 'CONTRACT') {
      result = await withLockedRecordForCollection('contracts', sourceId, (item) => {
        draft = recordActions.startContractPayment(freshUser, item, overrides);
        return item;
      });
    } else if (['MUA_BAN', 'SUA_CHUA'].includes(sourceModule)) {
      result = await withLockedRecordForCollection('officeReqs', sourceId, (item) => {
        draft = recordActions.startOfficePayment(freshUser, item, overrides);
        return item;
      });
    } else {
      return res.status(400).json({ error: 'Loại đề nghị không hợp lệ' });
    }
    const paymentRequests = await createPaymentRequestsFromDraft(draft);
    res.json({ ok: true, item: result, paymentRequest: paymentRequests[0], paymentRequests });
  } catch (err) {
    handleError(res, 'paymentRequests/from-source', err);
  }
});

// ===================== THANH TOÁN (module "Tổng Hợp" > "Thanh toán") =====================
async function withPaymentAction(req, res, action, mutator) {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('paymentRequests', itemId, (item) => mutator(req.body, freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `paymentRequests/${req.params.id}/${action}`, err);
  }
}

router.post('/paymentRequests/:id/edit', (req, res) =>
  withPaymentAction(req, res, 'edit', recordActions.editPaymentRequest));

// "Chuyển Xác Nhận Thanh Toán" (DRAFT -> PENDING) — ĐÚNG thời điểm số tiền từng đợt bị bắt buộc > 0 (xem
// submitPaymentRequest() ở lib/recordActions.js). "Duyệt đề nghị" (PENDING -> APPROVED) KHÔNG còn route
// riêng ở đây nữa — đã chuyển hẳn sang generic POST /api/workflow/paymentRequests/:id/approve (xem
// routes/workflow.js + lib/workflowEngine.js MODULE_CONFIGS.paymentRequests), theo ĐÚNG quy trình duyệt
// theo bước/phòng ban thay cho quyền phẳng canManagePaymentRequests() cũ. Route bespoke cũ
// POST /paymentRequests/:id/approve (+ hàm recordActions.approvePaymentRequest() nó gọi) đã bị GỠ HẲN —
// route generic ở routes/workflow.js đã tự có lớp xác thực lại (mật khẩu/OTP/PIN theo
// perms.approverAuthLevel) cho MỌI module trong MODULE_CONFIGS, bao gồm paymentRequests, nên không mất
// lớp bảo vệ này khi gỡ route cũ.
router.post('/paymentRequests/:id/submit', (req, res) =>
  withPaymentAction(req, res, 'submit', (payload, user, item) => recordActions.submitPaymentRequest(user, item)));

router.post('/paymentRequests/:id/request-info', (req, res) =>
  withPaymentAction(req, res, 'request-info', recordActions.requestPaymentInfo));

// Đề nghị thanh toán tới APPROVED thì bản ghi nguồn (Hợp đồng/officeReqs) đã bị startContractPayment()/
// tương đương chuyển sang paymentStatus=CHO_THANH_TOAN (xem confirm-installment ở dưới, ghi ngược
// DA_THANH_TOAN khi PAID) — xoá đề nghị ở PENDING/NEED_INFO/APPROVED trước đây để nguồn kẹt vĩnh viễn ở
// CHO_THANH_TOAN (contract.startContractPayment() chỉ cho chuyển từ CHUA_THANH_TOAN), không ai bấm lại
// được nút "Thanh toán" để tạo đề nghị mới. Trả nguồn về CHUA_THANH_TOAN khi xoá để có thể bắt đầu lại.
router.post('/paymentRequests/:id/delete', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    let deletedPr = null;
    await deleteRecordForCollection('paymentRequests', itemId, (item) => {
      recordActions.assertCanDeletePaymentRequest(freshUser, item);
      deletedPr = item;
    }, { username: freshUser.username, name: freshUser.name });
    if (deletedPr && deletedPr.sourceModule && deletedPr.sourceId != null) {
      // Đề nghị đã bị TÁCH theo lô (cycleGroupId) — chỉ trả nguồn về CHUA_THANH_TOAN khi CẢ lô đã hoàn tất
      // (không còn đợt anh em nào dang dở), tránh mở lại nguồn quá sớm trong khi các đợt khác của CÙNG chu
      // kỳ vẫn đang chờ duyệt/xác nhận (xem isCycleGroupFullyResolved() ở lib/recordActions.js).
      const allPrs = await getAllForCollection('paymentRequests');
      if (recordActions.isCycleGroupFullyResolved(deletedPr, allPrs)) {
        const sourceCollection = deletedPr.sourceModule === 'CONTRACT' ? 'contracts' : 'officeReqs';
        await withLockedRecordForCollection(sourceCollection, deletedPr.sourceId, (item) => {
          if (item.paymentStatus === 'CHO_THANH_TOAN') item.paymentStatus = 'CHUA_THANH_TOAN';
          return item;
        }).catch(() => {}); // nguồn có thể đã bị xoá — không chặn việc xoá đề nghị thanh toán hợp lệ
      }
    }
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `paymentRequests/${req.params.id}/delete`, err);
  }
});

// Xác nhận thanh toán (TỪNG ĐỢT — confirm-installment, hoặc TOÀN BỘ 1 LẦN — confirm-lump-sum, xem
// lib/recordActions.js confirmPaymentInstallment()/confirmPaymentRequestLumpSum()) — đủ hết các đợt (hay
// xác nhận lump-sum) thì tự chuyển PAID VÀ ghi ngược paymentStatus = DA_THANH_TOAN (hoặc CHUA_THANH_TOAN
// nếu nguồn là Hợp đồng "Thanh toán định kỳ") về đúng bản ghi nguồn (Hợp đồng/officeReqs), khớp yêu cầu
// "trả lại Đã thanh toán cho các module nguồn". Khoá TUẦN TỰ 2 collection (paymentRequests trước, bản ghi
// nguồn sau) trong CÙNG 1 request — không tách 2 lượt gọi để tránh trường hợp PAID rồi nhưng quên/lỗi
// bước ghi ngược. 2 route dùng CHUNG đúng 1 khối logic ghi ngược này (chỉ khác mutatorFn) — tách hàm dùng
// chung bên dưới thay vì chép lại y hệt 2 lần.
async function withPaymentConfirmAction(req, res, action, mutatorFn) {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    let justCompleted = false;
    const result = await withLockedRecordForCollection('paymentRequests', itemId, (item) => {
      const outcome = mutatorFn(req.body, freshUser, item);
      justCompleted = outcome.justCompleted;
      return outcome.item;
    });
    // Đề nghị đã bị TÁCH theo lô (cycleGroupId) — CHỈ 1 đợt vừa PAID xong, KHÔNG có nghĩa cả chu kỳ đã
    // xong (các đợt anh em khác cùng cycleGroupId có thể còn đang DRAFT/PENDING/APPROVED) — ghi ngược
    // paymentStatus về nguồn CHỈ khi isCycleGroupFullyResolved() xác nhận không còn đợt nào dang dở (đề
    // nghị ONE_TIME/thủ công không có cycleGroupId luôn coi là đã hoàn tất, giữ nguyên hành vi cũ).
    const cycleResolved = justCompleted && (await getAllForCollection('paymentRequests').then(
      list => recordActions.isCycleGroupFullyResolved(result, list)));
    if (cycleResolved && result.sourceModule && result.sourceId != null) {
      const sourceCollection = result.sourceModule === 'CONTRACT' ? 'contracts' : 'officeReqs';
      await withLockedRecordForCollection(sourceCollection, result.sourceId, (item) => {
        // Hợp đồng "Thanh toán định kỳ" (paymentType === 'PERIODIC') — 1 chu kỳ hoàn tất KHÔNG khoá cứng
        // "Đã thanh toán" như "Thanh toán 1 lần" nữa, mà TRẢ VỀ "Chưa thanh toán" để mở lại nút "🧾 Lập
        // Thanh Toán" cho chu kỳ MỚI (khớp yêu cầu nghiệp vụ "năm sau lại thanh toán"). officeReqs KHÔNG
        // có field paymentType (module Mua Bán/Sửa Chữa không có khái niệm định kỳ) -> luôn rơi vào
        // nhánh else như hành vi gốc, hoàn toàn không đổi. Đề nghị lump-sum (ONE_TIME) luôn rơi vào
        // nhánh else (paymentType luôn khác 'PERIODIC') -> luôn DA_THANH_TOAN, khớp đúng "1 lần" khoá cứng.
        item.paymentStatus = (sourceCollection === 'contracts' && item.paymentType === 'PERIODIC')
          ? 'CHUA_THANH_TOAN' : 'DA_THANH_TOAN';
        return item;
      }).catch(() => {}); // nguồn có thể đã bị xoá — không chặn việc đề nghị thanh toán đã PAID hợp lệ
    }
    res.json({ ok: true, item: result, justCompleted });
  } catch (err) {
    handleError(res, `paymentRequests/${req.params.id}/${action}`, err);
  }
}

router.post('/paymentRequests/:id/confirm-installment', (req, res) =>
  withPaymentConfirmAction(req, res, 'confirm-installment', recordActions.confirmPaymentInstallment));

// "💰 Xác nhận thanh toán (toàn bộ)" — CHỈ dùng cho đề nghị nguồn Hợp đồng "Thanh toán 1 lần"
// (pr.sourcePaymentType === 'ONE_TIME', xem confirmPaymentRequestLumpSum() ở lib/recordActions.js — hàm
// đó TỰ chặn 409 nếu gọi nhầm trên đề nghị "Thanh toán định kỳ"/thủ công/nguồn khác, đây KHÔNG phải lớp
// gác cổng DUY NHẤT, chỉ là route mirror đúng khuôn confirm-installment ở trên).
router.post('/paymentRequests/:id/confirm-lump-sum', (req, res) =>
  withPaymentConfirmAction(req, res, 'confirm-lump-sum', recordActions.confirmPaymentRequestLumpSum));

// Lập/sửa biên bản họp KHÔNG còn tự suy ra Công việc ngay khi lưu nữa — Công việc chỉ được tạo khi
// người dùng chủ động bấm "Giao việc" (xem POST /minutes/:id/assign-tasks bên dưới), sau đó biên bản
// bị khoá sửa. insertMinutesTasks() dùng chung cho endpoint đó (PHẢI tính created bên trong mutatorFn
// của dispatch, không phải sau khi dispatch đã trả về, để cờ "đã tạo việc" trên từng dòng chỉ đạo
// (directive.taskCreated) được LƯU LẠI đúng cùng bản ghi — tính sau khi đã lưu thì lần đọc lại từ CSDL
// sẽ không thấy cờ này và có thể tạo trùng việc).
async function insertMinutesTasks(createdTasks) {
  for (const c of createdTasks) await insertTask(c.item);
}

// POST /api/records/minutes — lập biên bản họp mới
router.post('/minutes', async (req, res) => {
  try {
    const { freshUser } = await getFreshUser(req);
    const { formTemplates } = await getAllAppData();
    const minutesItem = await createForCollection('meetingMinutes', (list) =>
      recordActions.createMinutes(req.body, freshUser, list, formTemplates)
    );
    res.json({ ok: true, item: minutesItem });
  } catch (err) {
    handleError(res, 'minutes (tạo mới)', err);
  }
});

// POST /api/records/minutes/:id/edit
router.post('/minutes/:id/edit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    // editMinutes() trả kèm "directiveIdMigrations" (không thuộc bản ghi biên bản) khi 1 dòng chỉ đạo
    // cũ (biên bản tạo trước tính năng id ổn định) lần đầu được bù id trong khi ĐÃ có Công Việc tham
    // chiếu theo vị trí — tách field này ra trước khi coi phần còn lại là bản ghi cần lưu, rồi đồng bộ
    // lại Task NGAY SAU khi lưu biên bản thành công (2 bảng khác nhau nên không chung 1 giao dịch được).
    let directiveIdMigrations = [];
    const result = await withLockedRecordForCollection('meetingMinutes', itemId, (item) => {
      const { directiveIdMigrations: migrations, ...updated } = recordActions.editMinutes(req.body, freshUser, item);
      directiveIdMigrations = migrations;
      return updated;
    });
    if (directiveIdMigrations.length) {
      await migrateDirectiveTaskLinks(result.code, directiveIdMigrations);
    }
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `minutes/${req.params.id}/edit`, err);
  }
});

// POST /api/records/minutes/:id/assign-tasks — "Giao việc" thủ công (nút ở danh sách biên bản họp):
// tạo Công việc hàng loạt cho mọi chỉ đạo đã gán người thực hiện, rồi khoá biên bản (tasksAssigned).
router.post('/minutes/:id/assign-tasks', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    // users: cần cho assignMinutesTasks() xác minh username khai ở "Thành phần tham dự" là tài khoản
    // hệ thống đang hoạt động TRƯỚC khi biến người đó thành người nhận việc (xem
    // resolveDirectiveAttendeeServer() ở lib/recordActions.js) — cùng khuôn danh sách user mà
    // routes/workflow.js truyền vào applyWorkflowAction() để tra lái xe khi duyệt phiếu xe.
    const { freshUser, users } = await getFreshUser(req);
    let createdTasks = [];
    const result = await withLockedRecordForCollection('meetingMinutes', itemId, (item) => {
      createdTasks = recordActions.assignMinutesTasks(freshUser, item, users);
      return item;
    });
    await insertMinutesTasks(createdTasks);
    res.json({ ok: true, item: result, createdTasks });
  } catch (err) {
    handleError(res, `minutes/${req.params.id}/assign-tasks`, err);
  }
});

// POST /api/records/minutes/:id/delete
router.post('/minutes/:id/delete', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    await deleteRecordForCollection('meetingMinutes', itemId, (item) => recordActions.assertCanDeleteMinutes(freshUser, item), { username: freshUser.username, name: freshUser.name });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `minutes/${req.params.id}/delete`, err);
  }
});

// Bước 6j — Truyền thông nội bộ: tương tác (đánh dấu đã đọc/thích/bình luận/đăng ký đào tạo) mở cho
// MỌI người dùng đã đăng nhập (khớp canCreateInternalPost() ở index.html — chỉ ĐĂNG bài mới cần quyền
// riêng theo type, xem/tương tác với bài đã đăng thì không) — cùng khuôn "khoá đúng 1 bài, gọi hàm xác
// minh + mutate ở lib/recordActions.js" như withTaskAction() bên dưới.
// assertCanViewInternalPost: CÙNG hàm canViewInternalPost() mà GET /api/data dùng để lọc danh sách bài
// (filterInternalPostsForUser) — mọi action ở dưới đều nạp bài THEO ID rồi trả NGUYÊN VĂN bài đó về
// client, nên nếu không kiểm tra quyền XEM trước khi mutate thì bất kỳ ai đã đăng nhập chỉ cần đoán id
// và gọi mark-read/like/comment/register-training là đọc trọn nội dung bài đang PENDING/REJECTED/
// NEED_INFO/HIDDEN (hoặc bài NEWS chưa tới publishAt) — vô hiệu hoá toàn bộ hàng rào ở phía GET.
// sanitizeInternalPostCommentsForUser() KHÔNG che được việc này (nó chỉ lọc metadata cờ bình luận).
function assertCanViewInternalPost(user, post) {
  if (!canViewInternalPost(user, post)) throw new HttpError(403, 'Bạn không có quyền xem bài viết này');
}

async function withInternalPostAction(req, res, action, mutator) {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('internalPosts', itemId, (item) => {
      assertCanViewInternalPost(freshUser, item);
      return mutator(req.body, freshUser, item);
    });
    // Bản ghi vừa mutate được trả NGUYÊN VĂN về client (client tự thay vào DB.internalPosts, không tải
    // lại GET /api/data) — trước đây bỏ qua hoàn toàn bước lọc kiểm duyệt bình luận mà GET /api/data đã
    // làm rất kỹ: các action ở đây MỞ CHO MỌI NGƯỜI đã đăng nhập (mark-read/like/comment-like/đăng ký
    // đào tạo), nên bất kỳ ai chỉ cần bấm "Thích" 1 bài đang có bình luận bị gắn cờ/đang chờ kiểm duyệt
    // là đọc được nguyên nội dung bình luận đó cùng toàn bộ metadata cờ (flagged/flagCategories/
    // flagTerms/flagDismissedBy) — đúng loại dữ liệu chỉ người kiểm duyệt được thấy. Lọc lại bằng CHÍNH
    // hàm GET /api/data dùng, không tự đoán lại luật (người có quyền duyệt vẫn nhận đủ như trước).
    res.json({ ok: true, item: sanitizeInternalPostCommentsForUser(result, freshUser) });
  } catch (err) {
    handleError(res, `internalPosts/${req.params.id}/${action}`, err);
  }
}

// POST /api/records/internalPosts/:id/mark-read
router.post('/internalPosts/:id/mark-read', (req, res) =>
  withInternalPostAction(req, res, 'mark-read', (payload, user, item) => recordActions.markInternalPostRead(user, item)));

// POST /api/records/internalPosts/:id/like
router.post('/internalPosts/:id/like', (req, res) =>
  withInternalPostAction(req, res, 'like', (payload, user, item) => recordActions.toggleInternalPostLike(user, item)));

// POST /api/records/internalPosts/:id/comment — đọc sẵn danh sách từ khoá nhạy cảm (DB.sensitiveKeywords)
// TRƯỚC khi khoá+ghi, truyền vào addInternalPostComment() để tự gắn cờ nếu khớp (xem
// lib/recordActions.js scanCommentForSensitiveContent()) — không dùng withInternalPostAction() chung
// vì cần đọc thêm AppData, khác các action còn lại chỉ cần đúng post đang khoá.
router.post('/internalPosts/:id/comment', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const sensitiveKeywords = (await getAppDataValue('sensitiveKeywords')) || [];
    const result = await withLockedRecordForCollection('internalPosts', itemId, (item) => {
      // Cùng lý do như assertCanViewInternalPost() ở withInternalPostAction() — route này tự khoá bản
      // ghi nên phải tự chặn người không có quyền xem bài (bình luận vào bài đang chờ duyệt = đọc bài).
      assertCanViewInternalPost(freshUser, item);
      return recordActions.addInternalPostComment(req.body, freshUser, item, sensitiveKeywords);
    });
    // Cùng lý do như withInternalPostAction() ở trên — route này không dùng helper chung nên phải lọc
    // riêng tại đây. Bình luận CỦA CHÍNH người vừa gửi vẫn được giữ lại kể cả khi bị đưa vào hàng chờ
    // kiểm duyệt (xem sanitizeInternalPostCommentsForUser), nên client vẫn hiển thị đúng bình luận họ
    // vừa viết + trạng thái "chờ kiểm duyệt" của nó.
    res.json({ ok: true, item: sanitizeInternalPostCommentsForUser(result, freshUser) });
  } catch (err) {
    handleError(res, `internalPosts/${req.params.id}/comment`, err);
  }
});

// POST /api/records/internalPosts/:id/comment/:commentId/dismiss-flag — người kiểm duyệt xem xét thấy
// bình luận không có vấn đề gì, chỉ gỡ cờ (không xoá). POST .../delete-comment — xoá hẳn bình luận vi
// phạm. Cả 2 chỉ dành cho canApproveInternalPost (kiểm tra ở lib/recordActions.js).
router.post('/internalPosts/:id/comment/:commentId/dismiss-flag', (req, res) =>
  withInternalPostAction(req, res, 'comment-dismiss-flag', (payload, user, item) =>
    recordActions.dismissInternalCommentFlag(user, item, Number(req.params.commentId))));

router.post('/internalPosts/:id/comment/:commentId/delete-comment', (req, res) =>
  withInternalPostAction(req, res, 'comment-delete', (payload, user, item) =>
    recordActions.deleteInternalPostComment(user, item, Number(req.params.commentId))));

// POST /api/records/internalPosts/:id/comment/:commentId/like — reaction cấp bình luận (Đợt 1 Nhịp
// Sống HCRC, dùng để xếp hạng "3-5 bình luận nổi bật" ở client), mở cho mọi người đã đăng nhập như
// like cấp bài viết ở trên.
router.post('/internalPosts/:id/comment/:commentId/like', (req, res) =>
  withInternalPostAction(req, res, 'comment-like', (payload, user, item) =>
    recordActions.toggleInternalPostCommentLike(user, item, Number(req.params.commentId))));

// POST /api/records/internalPosts/:id/register-training
router.post('/internalPosts/:id/register-training', (req, res) =>
  withInternalPostAction(req, res, 'register-training', (payload, user, item) => recordActions.registerInternalPostTraining(user, item)));

// POST /api/records/internalPosts/:id/unregister-training
router.post('/internalPosts/:id/unregister-training', (req, res) =>
  withInternalPostAction(req, res, 'unregister-training', (payload, user, item) => recordActions.unregisterInternalPostTraining(user, item)));

// POST /api/records/internalPosts/:id/approve|reject — duyệt/từ chối bài "Góc chia sẻ" (status PENDING
// gán sẵn khi tạo, xem lib/createValidation.js). Khác 5 hành động ở trên (mở cho mọi người), 2 hành
// động này cần quyền internalPostApprove/admin — kiểm tra ở lib/recordActions.js.
router.post('/internalPosts/:id/approve', (req, res) =>
  withInternalPostAction(req, res, 'approve', (payload, user, item) => recordActions.approveInternalPost(user, item)));

router.post('/internalPosts/:id/reject', (req, res) =>
  withInternalPostAction(req, res, 'reject', recordActions.rejectInternalPost));

// POST /api/records/internalPosts/:id/request-info — "Yêu cầu bổ sung" cho Góc Chia Sẻ (PENDING ->
// NEED_INFO), cùng khuôn Thanh Toán (requestPaymentInfo). Chỉ canApproveInternalPost (kiểm tra ở
// lib/recordActions.js).
router.post('/internalPosts/:id/request-info', (req, res) =>
  withInternalPostAction(req, res, 'request-info', recordActions.requestInternalPostInfo));

// POST /api/records/internalPosts/:id/hide|unhide — Admin chủ động ẩn/hiện lại bài đã đăng (APPROVED
// <-> HIDDEN, khác PENDING/REJECTED vốn là kết quả duyệt nội dung).
router.post('/internalPosts/:id/hide', (req, res) =>
  withInternalPostAction(req, res, 'hide', (payload, user, item) => recordActions.hideInternalPost(user, item)));

router.post('/internalPosts/:id/unhide', (req, res) =>
  withInternalPostAction(req, res, 'unhide', (payload, user, item) => recordActions.unhideInternalPost(user, item)));

// POST /api/records/internalPosts/:id/edit — sửa bài Nháp/bài "Yêu cầu bổ sung" (NEED_INFO) rồi tự gửi
// lại theo đúng luật gán status lúc tạo (chỉ tác giả/admin, kiểm tra ở lib/recordActions.js).
router.post('/internalPosts/:id/edit', (req, res) =>
  withInternalPostAction(req, res, 'edit', recordActions.editInternalPost));

// Bước 3 — Công việc có nhiều action cùng khuôn "tìm việc trong collection, khoá, gọi hàm xác minh +
// mutate ở lib/recordActions.js, trả về bản ghi mới" — gom vào 1 helper dùng chung thay vì lặp lại
// nguyên khối try/withLockedAppDataValue cho từng action (assign/edit/accept/status/gia hạn/huỷ việc...).
async function withTaskAction(req, res, action, mutator) {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const result = await withLockedTaskById(itemId, (task) => mutator(req.body, freshUser, task, users));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `tasks/${req.params.id}/${action}`, err);
  }
}

// POST /api/records/tasks — giao việc thủ công qua modal (khác việc tự động sinh từ chỉ đạo biên bản
// ở trên, không dùng chung route vì gate quyền khác nhau — xem lib/recordActions.js createTask()).
router.post('/tasks', async (req, res) => {
  try {
    const { freshUser, users } = await getFreshUser(req);
    const result = recordActions.createTask(req.body, freshUser, users);
    await insertTask(result);
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, 'tasks (tạo mới)', err);
  }
});

// POST /api/records/tasks/:id/assign — payload.assignedTo có thể là mảng nhiều username (Văn bản
// trình chỉ đạo giao cho nhiều người thực hiện cùng lúc). Không dùng withTaskAction() vì assignTask()
// giờ trả về { item, extraTasks } thay vì thẳng bản ghi — người đầu tiên gán vào task hiện có (trong
// khoá), những người còn lại là bản sao (extraTasks) được insertTask() SAU KHI khoá bản ghi gốc đã nhả
// (cùng khuôn draft-phụ đã dùng cho paymentRequests ở /contracts/:id/start-payment).
router.post('/tasks/:id/assign', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    let extraTasks = [];
    const result = await withLockedTaskById(itemId, (task) => {
      const outcome = recordActions.assignTask(req.body, freshUser, task, users);
      extraTasks = outcome.extraTasks || [];
      return outcome.item;
    });
    const createdExtra = [];
    for (const t of extraTasks) createdExtra.push(await insertTask(t));
    res.json({ ok: true, item: result, extraItems: createdExtra });
  } catch (err) {
    handleError(res, `tasks/${req.params.id}/assign`, err);
  }
});

// POST /api/records/tasks/:id/edit
router.post('/tasks/:id/edit', (req, res) => withTaskAction(req, res, 'edit', recordActions.editTask));

// POST /api/records/tasks/:id/accept — gộp acceptTask + acceptTaskOnBehalf (payload.onBehalf)
router.post('/tasks/:id/accept', (req, res) => withTaskAction(req, res, 'accept', recordActions.acceptTask));

// POST /api/records/tasks/:id/confirm-collaborator — gộp bản thân + xác nhận thay (payload.externalName)
router.post('/tasks/:id/confirm-collaborator', (req, res) => withTaskAction(req, res, 'confirm-collaborator', recordActions.confirmCollaboratorParticipation));

// POST /api/records/tasks/:id/status — "Cập nhật tiến độ" (payload: {newStatus, note})
router.post('/tasks/:id/status', (req, res) => withTaskAction(req, res, 'status', recordActions.updateTaskStatusAction));

// POST /api/records/tasks/:id/request-extension
router.post('/tasks/:id/request-extension', (req, res) => withTaskAction(req, res, 'request-extension', recordActions.requestExtension));

// POST /api/records/tasks/:id/approve-extension | reject-extension — dùng chung 1 engine duyệt/từ chối
router.post('/tasks/:id/approve-extension', (req, res) =>
  withTaskAction(req, res, 'approve-extension', (payload, user, task) => recordActions.resolvePendingTaskAction('extension', 'approve', user, task)));
router.post('/tasks/:id/reject-extension', (req, res) =>
  withTaskAction(req, res, 'reject-extension', (payload, user, task) => recordActions.resolvePendingTaskAction('extension', 'reject', user, task)));

// POST /api/records/tasks/:id/cancel — huỷ ngay (người giao việc/admin) hoặc gửi yêu cầu (người nhận/phối hợp)
router.post('/tasks/:id/cancel', (req, res) => withTaskAction(req, res, 'cancel', recordActions.cancelOrRequestCancelTask));

// POST /api/records/tasks/:id/approve-cancellation | reject-cancellation — cùng engine duyệt/từ chối trên
router.post('/tasks/:id/approve-cancellation', (req, res) =>
  withTaskAction(req, res, 'approve-cancellation', (payload, user, task) => recordActions.resolvePendingTaskAction('cancellation', 'approve', user, task)));
router.post('/tasks/:id/reject-cancellation', (req, res) =>
  withTaskAction(req, res, 'reject-cancellation', (payload, user, task) => recordActions.resolvePendingTaskAction('cancellation', 'reject', user, task)));

// POST /api/records/tasks/:id/add-subtask | toggle-subtask | delete-subtask — công việc nhỏ tự chia
// trong "Cập Nhật Tiến Độ" (chỉ chính người nhận việc/admin, xem lib/recordActions.js canManageSubtasks()).
router.post('/tasks/:id/add-subtask', (req, res) => withTaskAction(req, res, 'add-subtask', recordActions.addSubtask));
router.post('/tasks/:id/toggle-subtask', (req, res) => withTaskAction(req, res, 'toggle-subtask', recordActions.toggleSubtask));
router.post('/tasks/:id/delete-subtask', (req, res) => withTaskAction(req, res, 'delete-subtask', recordActions.deleteSubtask));

// POST /api/records/tasks/:id/delete
router.post('/tasks/:id/delete', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    await deleteTaskById(itemId, () => recordActions.assertCanDeleteTask(freshUser));
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `tasks/${req.params.id}/delete`, err);
  }
});

// ===================== XÓA "QUYỀN TỐI CAO" (chỉ Admin) =====================
// Tài liệu/Văn bản trình/Hợp đồng/Mua Bán-Sửa Chữa-Đầu Tư/Đăng Ký Xe trước đây KHÔNG có chức năng xóa
// nào cả (không nút, không route) — giờ thêm, nhưng CHỈ Admin mới xóa được (đúng yêu cầu nghiệp vụ:
// người dùng thường bị khóa xóa hoàn toàn ở các module này, quyền xóa dồn hết về 1 "quyền tối cao").
// Dùng chung deleteRecordForCollection() (5 collection này đều đã ở dbo.Records, xem lib/recordStore.js).
function assertAdminForDelete(user) {
  if (!user.perms?.admin) throw new HttpError(403, 'Chỉ Quản Trị Viên mới có quyền xóa dữ liệu ở module này');
}
// Chặn xoá Hợp đồng/Mua Bán-Sửa Chữa-Đầu Tư nếu còn Đề nghị thanh toán tham chiếu tới hồ sơ này (xem
// startContractPayment()/startOfficePayment() ở lib/recordActions.js, gắn sourceModule/sourceId khi
// tạo) — trước đây không kiểm tra: xoá xong, đề nghị thanh toán vẫn còn nguyên nhưng sourceId không
// còn trỏ tới bản ghi sống nào, liên kết "xem hồ sơ nguồn" treo tới khi khôi phục từ Thùng Rác. Khớp
// đúng tinh thần assertCanDeleteMinutes() (chặn xoá Biên bản họp khi còn Công việc tham chiếu).
async function assertNoReferencingPaymentRequests(sourceModule, itemId, label) {
  const paymentRequests = await getAllForCollection('paymentRequests');
  const referencing = paymentRequests.filter(pr => pr.sourceModule === sourceModule && pr.sourceId === itemId);
  if (referencing.length) {
    throw new HttpError(409, `Không thể xóa ${label} này vì còn ${referencing.length} đề nghị thanh toán đang tham chiếu tới. Vui lòng xử lý/xóa các đề nghị thanh toán liên quan trước.`);
  }
}
async function deleteAdminOnly(req, res, collection) {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    await deleteRecordForCollection(collection, itemId, () => assertAdminForDelete(freshUser), { username: freshUser.username, name: freshUser.name });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `${collection}/${req.params.id}/delete`, err);
  }
}
// Xóa 1 "họ" tài liệu (Tài liệu gốc + toàn bộ version con) khi xóa tài liệu GỐC — trước đây xóa tài
// liệu gốc chỉ xóa đúng 1 dòng qua deleteAdminOnly() chung, để lại các version con với rootDocId trỏ
// vào 1 id không còn tồn tại (mồ côi): getDocFamily()/getDocFamilyLatest() ở client vẫn lọc theo
// rootDocId nên hiện ra lẫn lộn, và nhánh "Cập nhật" (lib/createValidation.js docs.extraValidate) sẽ
// luôn báo "Tài liệu gốc không tồn tại" cho họ tài liệu đó. Xóa 1 version CON (không phải gốc) thì
// không cần cascade gì thêm — các version khác trong họ không phụ thuộc vào nó.
router.post('/docs/:id/delete', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    assertAdminForDelete(freshUser);
    const preDocs = await getAllForCollection('docs');
    const preTarget = preDocs.find(d => d.id === itemId);
    if (!preTarget) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    // Khoá theo ID GỐC của cả "họ" (không phải id đang xoá) — CÙNG khoá mà routes/create.js dùng khi
    // tạo version mới (doc_family:<rootDocId>) — chặn race giữa "tạo version mới" và "xoá cả family"
    // chạy đan xen (xem giải thích ở routes/create.js). Đọc lại family BÊN TRONG khoá để cascade đúng
    // theo trạng thái mới nhất, kể cả khi có 1 version vừa được tạo xong ngay trước khi giành được khoá.
    const familyRootId = preTarget.rootDocId == null ? itemId : preTarget.rootDocId;
    await withAppLock(`doc_family:${familyRootId}`, async () => {
      const docs = await getAllForCollection('docs');
      const target = docs.find(d => d.id === itemId);
      if (!target) throw new HttpError(404, 'Không tìm thấy hồ sơ');
      const memberIds = target.rootDocId == null
        ? docs.filter(d => d.id === itemId || d.rootDocId === itemId).map(d => d.id)
        : [itemId];
      for (const id of memberIds) {
        await deleteRecordForCollection('docs', id, () => assertAdminForDelete(freshUser), { username: freshUser.username, name: freshUser.name });
      }
    });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `docs/${req.params.id}/delete`, err);
  }
});
router.post('/submissions/:id/delete', (req, res) => deleteAdminOnly(req, res, 'submissions'));
// Xóa hợp đồng GỐC kèm cascade toàn bộ phụ lục của nó — trước đây chỉ xóa đúng 1 dòng qua
// deleteAdminOnly() chung, để lại phụ lục với rootContractId trỏ vào 1 id không còn tồn tại (hiển thị
// mã hợp đồng gốc là "?" ở Chi tiết). Xóa 1 PHỤ LỤC (không phải gốc) thì không cần cascade gì thêm.
router.post('/contracts/:id/delete', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    assertAdminForDelete(freshUser);
    const preContracts = await getAllForCollection('contracts');
    const preTarget = preContracts.find(c => c.id === itemId);
    if (!preTarget) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    // Cùng cơ chế/lý do với docs ở trên — khoá theo ID GỐC của cả family (khớp
    // contract_family:<rootContractId> mà routes/create.js dùng khi tạo phụ lục mới), đọc lại family
    // bên trong khoá để cascade đúng theo trạng thái mới nhất.
    const familyRootId = preTarget.isAddendum ? preTarget.rootContractId : itemId;
    await withAppLock(`contract_family:${familyRootId}`, async () => {
      const contracts = await getAllForCollection('contracts');
      const target = contracts.find(c => c.id === itemId);
      if (!target) throw new HttpError(404, 'Không tìm thấy hồ sơ');
      const memberIds = !target.isAddendum
        ? contracts.filter(c => c.id === itemId || c.rootContractId === itemId).map(c => c.id)
        : [itemId];
      for (const id of memberIds) {
        await assertNoReferencingPaymentRequests('CONTRACT', id, 'hợp đồng/phụ lục');
      }
      for (const id of memberIds) {
        await deleteRecordForCollection('contracts', id, () => assertAdminForDelete(freshUser), { username: freshUser.username, name: freshUser.name });
      }
    });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `contracts/${req.params.id}/delete`, err);
  }
});
// Không dùng deleteAdminOnly() chung — cần đọc lại hồ sơ TRƯỚC để biết subType (Mua Bán/Sửa Chữa/Đầu
// Tư — đây chính là sourceModule startOfficePayment() ghi vào paymentRequests khi tạo) rồi mới kiểm
// tra tham chiếu, cùng lý do/cơ chế với contracts/:id/delete ở trên.
router.post('/officeReqs/:id/delete', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    assertAdminForDelete(freshUser);
    const officeReqs = await getAllForCollection('officeReqs');
    const target = officeReqs.find(r => r.id === itemId);
    if (!target) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    await assertNoReferencingPaymentRequests(target.subType, itemId, 'đề xuất');
    await deleteRecordForCollection('officeReqs', itemId, () => assertAdminForDelete(freshUser), { username: freshUser.username, name: freshUser.name });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `officeReqs/${req.params.id}/delete`, err);
  }
});
router.post('/carRegs/:id/delete', (req, res) => deleteAdminOnly(req, res, 'carRegs'));

// Lái xe được phân công (assignedDriverUsername, gán lúc duyệt — xem routes/workflow.js) tự xác nhận
// đúng chuyến của mình ở sub-tab "Lái Xe" — chỉ đúng tài khoản được gán mới gọi được (kiểm tra trong
// confirmCarDriverAssignment()), không cần quyền admin/carView riêng gì thêm.
router.post('/carRegs/:id/confirm-driver', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('carRegs', itemId, (item) =>
      recordActions.confirmCarDriverAssignment(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `carRegs/${req.params.id}/confirm-driver`, err);
  }
});

// "Hủy chuyến" — CHỈ hồ sơ đang APPROVED (Fix 4, đợt rà soát nghiệp vụ: trước đây phiếu đã duyệt là
// NGÕ CỤT, chỉ admin xoá cứng được) — mirror POST /api/meetings/:id/cancel (routes/meetingActions.js):
// tự huỷ được chuyến của chính mình HOẶC carDispatch/admin huỷ được của bất kỳ ai, xem
// canCancelCarReg()/cancelCarReg() ở lib/recordActions.js.
router.post('/carRegs/:id/cancel', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('carRegs', itemId, (item) =>
      recordActions.cancelCarReg(freshUser, item, req.body || {}));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `carRegs/${req.params.id}/cancel`, err);
  }
});

// "Đổi tài xế-xe" — CHỈ Người Điều Hành Xe (carDispatch)/admin, CHỈ hồ sơ đang APPROVED — reassignCarDispatch()
// (lib/recordActions.js) cần đọc TOÀN BỘ carRegs hiện có để tái kiểm tra trùng biển số (mirror đúng
// applyWorkflowAction() ở lib/workflowEngine.js/findCarPlateConflict()) + danh sách users để đối chiếu
// tài khoản lái xe mới — đọc TRƯỚC khi khoá bản ghi (cùng khuôn allMeetings ở routes/meetingActions.js).
router.post('/carRegs/:id/reassign', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const existingCarRegs = await getAllForCollection('carRegs');
    const result = await withLockedRecordForCollection('carRegs', itemId, (item) =>
      recordActions.reassignCarDispatch(freshUser, item, req.body || {}, existingCarRegs, users));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `carRegs/${req.params.id}/reassign`, err);
  }
});
router.post('/vppPeriods/:id/delete', (req, res) => deleteAdminOnly(req, res, 'vppPeriods'));
router.post('/vppRegistrations/:id/delete', (req, res) => deleteAdminOnly(req, res, 'vppRegistrations'));
router.post('/reportPeriods/:id/delete', (req, res) => deleteAdminOnly(req, res, 'reportPeriods'));
router.post('/reportEntries/:id/delete', (req, res) => deleteAdminOnly(req, res, 'reportEntries'));
router.post('/budgetPeriods/:id/delete', (req, res) => deleteAdminOnly(req, res, 'budgetPeriods'));
router.post('/budgetEntries/:id/delete', (req, res) => deleteAdminOnly(req, res, 'budgetEntries'));
// Không dùng deleteAdminOnly() chung — chặn xoá mẫu ngân sách còn đang được 1 kỳ ngân sách tham chiếu
// (budgetPeriod.templateId). Trước đây xoá được vô điều kiện: getBudgetTemplateCustomFields() (xem
// lib/createValidation.js) không tìm thấy template sẽ âm thầm fallback về 4 cột lõi mặc định — lần
// sửa/lưu NHÁP tiếp theo (sanitizeBudgetLines) tính lại "extra" theo bộ cột rỗng đó, xoá sạch dữ liệu
// cột tuỳ biến phòng ban đã nhập mà không có cảnh báo nào.
router.post('/budgetTemplates/:id/delete', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    assertAdminForDelete(freshUser);
    const periods = await getAllForCollection('budgetPeriods');
    const referencing = periods.filter(p => p.templateId === itemId);
    if (referencing.length) {
      throw new HttpError(409, `Không thể xóa mẫu ngân sách này vì còn ${referencing.length} kỳ ngân sách đang sử dụng. Vui lòng đổi mẫu cho các kỳ đó trước.`);
    }
    await deleteRecordForCollection('budgetTemplates', itemId, () => assertAdminForDelete(freshUser), { username: freshUser.username, name: freshUser.name });
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `budgetTemplates/${req.params.id}/delete`, err);
  }
});

// ===================== VẬN HÀNH (operationOrders / operationStoreOpenings / operationRepairs) =====================
router.post('/operationOrders/:id/delete', (req, res) => deleteAdminOnly(req, res, 'operationOrders'));
// "Hồ sơ Mở Mới/Sửa Chữa Siêu Thị sau khi lập xong KHÔNG được xoá" — yêu cầu người dùng, đợt "Danh Mục
// Đầu Tư + bỏ Tạo Kỳ". TRƯỚC ĐÂY route này cho admin xoá CASCADE (kèm operationExecutionPeriods + cây
// dbo.OperationWorkItems) — nay chặn HẲN, không còn ngoại lệ nào (kể cả admin), khác mọi collection khác
// trong hệ thống vẫn giữ deleteAdminOnly(). Chặn ở ĐÚNG route này (không chỉ ẩn nút ở client) vì đây là
// nơi thật sự ghi CSDL — 1 request tự soạn bỏ qua UI trước đây vẫn xoá được nếu biết id.
function rejectOperationDelete(req, res) {
  return res.status(403).json({ error: 'Hồ sơ Mở mới/Sửa chữa siêu thị sau khi đã lập không được phép xoá.' });
}
router.post('/operationStoreOpenings/:id/delete', rejectOperationDelete);
router.post('/operationRepairs/:id/delete', rejectOperationDelete);

// ===================== ĐÀO TẠO (module con "Truyền Thông Nội Bộ" > Đào tạo) — tạm thời, MVP =====================
router.post('/trainingDocuments/:id/delete', (req, res) => deleteAdminOnly(req, res, 'trainingDocuments'));
router.post('/trainingClasses/:id/delete', (req, res) => deleteAdminOnly(req, res, 'trainingClasses'));
router.post('/careerPaths/:id/delete', (req, res) => deleteAdminOnly(req, res, 'careerPaths'));
router.post('/trainingTests/:id/delete', (req, res) => deleteAdminOnly(req, res, 'trainingTests'));
// Đợt 4: trainingCourses — xoá cùng khuôn "xóa = quyền tối cao, chỉ Admin" của mọi collection Đào Tạo khác ở trên.
router.post('/trainingCourses/:id/delete', (req, res) => deleteAdminOnly(req, res, 'trainingCourses'));

// POST /api/records/trainingPlans/:id/edit (Đợt 5: Kế Hoạch Đào Tạo) — sửa 1 dòng kế hoạch đã lập. Đọc
// kèm appData (depts/stores có sẵn, dùng để kiểm tra targetDept) + trainingCourses (kiểm tra courseId
// mới nếu có đổi) TRƯỚC khi khoá đúng 1 dòng trainingPlans để sửa — cùng khuôn trainingClasses/:id/edit
// ở dưới xa hơn trong file này.
router.post('/trainingPlans/:id/edit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const appData = await getAllAppData();
    appData.trainingCourses = await getAllForCollection('trainingCourses');
    const result = await withLockedRecordForCollection('trainingPlans', itemId, (item) =>
      recordActions.editTrainingPlan(req.body, freshUser, item, appData));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `trainingPlans/${req.params.id}/edit`, err);
  }
});
// Xoá kế hoạch — cùng khuôn "xóa = quyền tối cao, chỉ Admin" như trainingCourses ở trên (KHÔNG chỉ
// trainingManage — số thực tế đối chiếu vẫn tính sống từ trainingClasses/trainingRegistrations, không
// phụ thuộc gì vào việc kế hoạch còn tồn tại hay không, nên xoá nhầm không làm mất dữ liệu đã phát sinh).
router.post('/trainingPlans/:id/delete', (req, res) => deleteAdminOnly(req, res, 'trainingPlans'));

// ===================== ĐÀO TẠO TÂN BINH =====================
// POST /api/records/onboardingPaths/:id/edit — sửa 1 Lộ Trình đã tạo. getAllAppData() đã đọc sẵn
// trainingCourses (dùng để kiểm tra stage{1,2}RequiredCourseIds mới nếu có đổi, xem
// normalizeOnboardingPathFields()) TRƯỚC khi khoá đúng 1 dòng onboardingPaths để sửa — cùng khuôn
// trainingPlans/:id/edit ở trên.
router.post('/onboardingPaths/:id/edit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const appData = await getAllAppData();
    const result = await withLockedRecordForCollection('onboardingPaths', itemId, (item) =>
      recordActions.editOnboardingPath(req.body, freshUser, item, appData));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `onboardingPaths/${req.params.id}/edit`, err);
  }
});
// Xoá Lộ Trình — cùng khuôn "xóa = quyền tối cao, chỉ Admin" như mọi catalog Đào Tạo khác ở trên (KHÔNG
// xoá kèm theo các onboardingProgress đã phân công theo lộ trình này — những hồ sơ đó giữ nguyên
// pathName đã snapshot, chỉ mất khả năng tra cứu lại stage{1,2}RequiredCourseIds/stage3Criteria gốc;
// chấp nhận đánh đổi này, cùng tinh thần trainingCourses/trainingPlans xoá không dọn dẹp dữ liệu đã phát sinh).
router.post('/onboardingPaths/:id/delete', (req, res) => deleteAdminOnly(req, res, 'onboardingPaths'));

// POST /api/records/onboardingProgress/:id/confirm-stage — Nhân Sự (trainingManage/admin) xác nhận nhân
// viên đã hoàn thành Giai đoạn 1/2 (Đợt 8 — cùng khuôn /careerPaths/:id/confirm ở dưới: đọc kèm
// trainingRegistrations/trainingClasses để tra "đã Đạt đủ chương trình bắt buộc của giai đoạn chưa", chỉ
// khác là kết quả ghi THẲNG vào đúng 1 dòng onboardingProgress đang khoá, không cần insert thêm collection
// phụ nào khác vì onboardingProgress vốn đã LÀ hồ sơ theo từng nhân viên, không phải catalog dùng chung
// như careerPaths).
router.post('/onboardingProgress/:id/confirm-stage', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const paths = await getAllForCollection('onboardingPaths');
    const allRegs = await getAllForCollection('trainingRegistrations');
    const trainingClasses = await getAllForCollection('trainingClasses');
    const result = await withLockedRecordForCollection('onboardingProgress', itemId, (item) => {
      const path = paths.find(p => p.id === item.pathId);
      return recordActions.confirmOnboardingStage(req.body, freshUser, item, path, allRegs, trainingClasses);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `onboardingProgress/${req.params.id}/confirm-stage`, err);
  }
});
// POST /api/records/onboardingProgress/:id/evaluate-stage3 — quản lý CÙNG phòng ban/siêu thị với nhân
// viên được phân công (onboardingEvaluate) đánh giá Giai đoạn 3. Cần req.allUsers (dept THẬT hiện tại
// của nhân viên, đọc sống — xem canEvaluateOnboardingStage3(), lib/recordActions.js) — getFreshUser() đã
// có sẵn từ requireAuth, không cần đọc DB thêm lần nào nữa.
router.post('/onboardingProgress/:id/evaluate-stage3', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('onboardingProgress', itemId, (item) =>
      recordActions.evaluateOnboardingStage3(req.body, freshUser, item, users));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `onboardingProgress/${req.params.id}/evaluate-stage3`, err);
  }
});
// POST /api/records/onboardingProgress/:id/issue-certificate — trainingManage/admin cấp Chứng Chỉ Hoàn
// Thành sau khi cả 3 giai đoạn đã Đạt. Server CHỈ đánh dấu certificateIssued/issuedAt/issuedBy — PDF
// dựng lại hoàn toàn ở client (xem lib/recordActions.js issueOnboardingCertificate()).
router.post('/onboardingProgress/:id/issue-certificate', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('onboardingProgress', itemId, (item) =>
      recordActions.issueOnboardingCertificate(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `onboardingProgress/${req.params.id}/issue-certificate`, err);
  }
});
// Xoá 1 dòng Phân Công — cùng khuôn "xóa = quyền tối cao, chỉ Admin" như mọi collection Đào Tạo khác.
router.post('/onboardingProgress/:id/delete', (req, res) => deleteAdminOnly(req, res, 'onboardingProgress'));

async function withTrainingRegAction(req, res, action, mutator) {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('trainingRegistrations', itemId, (item) => mutator(req.body, freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `trainingRegistrations/${req.params.id}/${action}`, err);
  }
}
router.post('/trainingRegistrations/:id/cancel', (req, res) =>
  withTrainingRegAction(req, res, 'cancel', recordActions.cancelTrainingRegistration));
// Đợt 9 — duyệt/từ chối yêu cầu huỷ (chỉ trainingManage/admin, gác ngay trong
// approveCancelTrainingRegistration()/rejectCancelTrainingRegistration() — không cần đọc kèm
// trainingClasses nên dùng chung được withTrainingRegAction() như 'cancel' ở trên).
router.post('/trainingRegistrations/:id/approve-cancel', (req, res) =>
  withTrainingRegAction(req, res, 'approve-cancel', recordActions.approveCancelTrainingRegistration));
router.post('/trainingRegistrations/:id/reject-cancel', (req, res) =>
  withTrainingRegAction(req, res, 'reject-cancel', recordActions.rejectCancelTrainingRegistration));

// Đợt 9 — đánh dấu đã xem 1 tài liệu giáo trình bắt buộc (lớp ONLINE) — cần đọc kèm trainingClasses để
// biết cls.documentIds (danh sách tài liệu bắt buộc thật sự của lớp), không dùng chung được
// withTrainingRegAction() ở trên (không có cls sẵn), cùng lý do set-result ngay dưới đây.
router.post('/trainingRegistrations/:id/mark-document-viewed', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const regs = await getAllForCollection('trainingRegistrations');
    const reg = regs.find(r => r.id === itemId);
    if (!reg) throw new HttpError(404, 'Không tìm thấy đăng ký');
    const classes = await getAllForCollection('trainingClasses');
    const cls = classes.find(c => c.id === reg.classId);
    const result = await withLockedRecordForCollection('trainingRegistrations', itemId, (item) =>
      recordActions.markTrainingDocumentViewed(req.body, freshUser, item, cls));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `trainingRegistrations/${req.params.id}/mark-document-viewed`, err);
  }
});

// "Bắt Buộc Hoàn Thành" có logic thật (video/PDF) — POST /api/records/trainingDocuments/:id/track-progress.
// Bất kỳ ai đã đăng nhập cũng gọi được (trainingDocuments công khai toàn công ty, cùng tinh thần
// mark-document-viewed ở trên) — route TỰ suy ra "kind" (VIDEO/PDF) từ doc.docType thật, KHÔNG tin
// payload.kind client gửi (chặn 1 request tự soạn báo khống "đã xem hết PDF" cho 1 tài liệu video, hay
// ngược lại). Khoá theo docId+username TRONG SUỐT đọc-hợp nhất-ghi (video/PDF poll tiến độ mỗi vài giây,
// cùng 1 người có thể gửi gần như đồng thời — cùng lý do training_test_submission ở submit-test).
router.post('/trainingDocuments/:id/track-progress', async (req, res) => {
  const docId = Number(req.params.id);
  if (!Number.isFinite(docId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withAppLock(`training_doc_progress:${docId}:${freshUser.username}`, async () => {
      const docs = await getAllForCollection('trainingDocuments');
      const doc = docs.find(d => d.id === docId);
      if (!doc) throw new HttpError(404, 'Không tìm thấy tài liệu');
      const isPdfDoc = doc.docType === 'DOCUMENT' && /\.pdf$/i.test(doc.fileName || '');
      if (doc.docType !== 'VIDEO' && !isPdfDoc) {
        throw new HttpError(400, 'Tài liệu này không thuộc loại được theo dõi tiến độ (chỉ video/PDF)');
      }
      const kind = doc.docType === 'VIDEO' ? 'VIDEO' : 'PDF';

      const progressList = await getAllForCollection('trainingDocumentProgress');
      const existing = progressList.find(p => p.docId === docId && p.username === freshUser.username);
      const { fields, completedNow } = recordActions.computeTrainingDocumentProgressUpdate(existing, { ...req.body, kind });

      const progressRow = existing
        ? await withLockedRecordForCollection('trainingDocumentProgress', existing.id, (item) => Object.assign(item, fields))
        : await insertRecord('trainingDocumentProgress', {
            id: Date.now(), docId, username: freshUser.username, name: freshUser.name, dept: freshUser.dept, ...fields
          });

      // Hoàn thành LẦN ĐẦU (completedNow) -> tự động đánh dấu "đã xem" cho MỌI đăng ký (lớp ONLINE) đang
      // coi tài liệu này là giáo trình bắt buộc — thay hẳn cú click thủ công của
      // markTrainingDocumentViewed() cho đúng 2 loại có tín hiệu khách quan này (KHÔNG đổi gì ở hàm đó —
      // IMAGE/tài liệu không phải PDF vẫn dùng cú click thủ công như trước).
      const updatedRegistrations = [];
      if (completedNow) {
        const classes = await getAllForCollection('trainingClasses');
        const relevantClassIds = new Set(classes
          .filter(c => c.mode === 'ONLINE' && Array.isArray(c.documentIds) && c.documentIds.includes(docId))
          .map(c => c.id));
        if (relevantClassIds.size) {
          const regs = await getAllForCollection('trainingRegistrations');
          const myRegs = regs.filter(r => r.creator === freshUser.username && r.result !== 'CANCELLED' && relevantClassIds.has(r.classId));
          for (const reg of myRegs) {
            const cls = classes.find(c => c.id === reg.classId);
            const updatedReg = await withLockedRecordForCollection('trainingRegistrations', reg.id, (item) =>
              recordActions.markTrainingDocumentViewed({ documentId: docId }, freshUser, item, cls));
            updatedRegistrations.push(updatedReg);
          }
        }
      }

      return { progress: progressRow, updatedRegistrations };
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    handleError(res, `trainingDocuments/${req.params.id}/track-progress`, err);
  }
});

// set-result (Đợt 3) cần đọc kèm trainingClasses — quyền ghi giờ so theo canManageTrainingClass()
// (trainingManage quản lý MỌI lớp, trainingInstruct chỉ đúng lớp mình được gán làm giảng viên, xem
// lib/recordActions.js), không còn so trực tiếp reg.classCreator như trước Đợt 3 nên không dùng chung
// được withTrainingRegAction() ở trên nữa (không có cls sẵn).
router.post('/trainingRegistrations/:id/set-result', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const regs = await getAllForCollection('trainingRegistrations');
    const reg = regs.find(r => r.id === itemId);
    if (!reg) throw new HttpError(404, 'Không tìm thấy đăng ký');
    const classes = await getAllForCollection('trainingClasses');
    const cls = classes.find(c => c.id === reg.classId);
    if (!cls) throw new HttpError(404, 'Không tìm thấy lớp học của đăng ký này');
    const result = await withLockedRecordForCollection('trainingRegistrations', itemId, (item) =>
      recordActions.setTrainingRegistrationResult(req.body, freshUser, item, cls));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `trainingRegistrations/${req.params.id}/set-result`, err);
  }
});

// POST /api/records/trainingClasses/:id/bulk-register — nhân sự (người tạo lớp) hoặc Admin thêm HÀNG
// LOẠT học viên vào 1 lớp cùng lúc (dropdown chọn từng người, hoặc theo danh sách đọc từ file Excel —
// cả 2 cách client đều gửi lên đúng { usernames: [...] }). Khoá theo classId trong SUỐT lúc đọc-kiểm
// tra-ghi (khác withLockedRecordForCollection chỉ khoá đúng 1 dòng) vì ở đây ghi NHIỀU bản ghi mới cùng
// lúc, cần đọc "ảnh chụp" trainingRegistrations hiện có ổn định suốt quá trình kiểm tra trùng/còn chỗ.
router.post('/trainingClasses/:id/bulk-register', async (req, res) => {
  const classId = Number(req.params.id);
  if (!Number.isFinite(classId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const result = await withAppLock(`training_class_roster:${classId}`, async () => {
      const classes = await getAllForCollection('trainingClasses');
      const cls = classes.find(c => c.id === classId);
      if (!cls) throw new HttpError(404, 'Không tìm thấy lớp học');
      const existingRegs = await getAllForCollection('trainingRegistrations');
      const { added, skipped } = recordActions.bulkRegisterTrainingClass(req.body, freshUser, cls, existingRegs, users);
      const inserted = [];
      for (let i = 0; i < added.length; i++) {
        inserted.push(await insertRecord('trainingRegistrations', { ...added[i], id: Date.now() + i }));
      }
      return { added: inserted, skipped };
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    handleError(res, `trainingClasses/${req.params.id}/bulk-register`, err);
  }
});

// POST /api/records/trainingClasses/:id/edit (Đợt 3) — sửa nội dung/lịch lớp học đã tạo. Đọc kèm
// trainingTests (kiểm tra testId mới nếu có đổi, cùng lý do routes/create.js) + req.allUsers (resolve
// lại instructorUsername nếu có đổi giảng viên) + trainingCourses (Đợt 4: kiểm tra courseId mới nếu có
// đổi) TRƯỚC khi khoá đúng 1 dòng trainingClasses để sửa.
router.post('/trainingClasses/:id/edit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const tests = await getAllForCollection('trainingTests');
    const courses = await getAllForCollection('trainingCourses');
    const result = await withLockedRecordForCollection('trainingClasses', itemId, (item) =>
      recordActions.editTrainingClass(req.body, freshUser, item, tests, users, courses));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `trainingClasses/${req.params.id}/edit`, err);
  }
});

// POST /api/records/trainingClasses/:id/start-session và .../end-session (Đợt 3) — vòng đời trạng thái
// buổi học THỦ CÔNG cho lớp OFFLINE ("Bắt Đầu Lớp"/"Kết Thúc Lớp"), KHÁC hẳn "status" (còn mở/đóng đăng
// ký). Lớp ONLINE không có 2 action này (tính sống theo giờ, xem createValidation.js/index.html).
router.post('/trainingClasses/:id/start-session', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('trainingClasses', itemId, (item) =>
      recordActions.startOfflineTrainingClass(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `trainingClasses/${req.params.id}/start-session`, err);
  }
});
router.post('/trainingClasses/:id/end-session', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('trainingClasses', itemId, (item) =>
      recordActions.endOfflineTrainingClass(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `trainingClasses/${req.params.id}/end-session`, err);
  }
});

// POST /api/records/trainingClasses/:id/start-test — học viên MỞ đề (client gọi ngay trong
// openTakeTestModal(), public/index.html): ghi mốc bắt đầu Ở SERVER lên đúng dòng đăng ký của người đó
// để submit-test bên dưới đối chiếu được thời gian làm bài thật, thay vì chỉ tin đồng hồ đếm ngược ở
// client (xem startTrainingTestAttempt() ở lib/recordActions.js). Chỉ ghi LẦN ĐẦU, mở lại không làm mới.
router.post('/trainingClasses/:id/start-test', async (req, res) => {
  const classId = Number(req.params.id);
  if (!Number.isFinite(classId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const classes = await getAllForCollection('trainingClasses');
    const cls = classes.find(c => c.id === classId);
    if (!cls) throw new HttpError(404, 'Không tìm thấy lớp học');
    if (cls.testId == null) throw new HttpError(400, 'Lớp học này chưa được gán bài test');

    const regs = await getAllForCollection('trainingRegistrations');
    const reg = regs.find(r => r.classId === classId && r.creator === freshUser.username && r.result !== 'CANCELLED');
    if (!reg) throw new HttpError(403, 'Bạn chưa đăng ký lớp học này nên không thể làm bài test');

    const result = await withLockedRecordForCollection('trainingRegistrations', reg.id, (item) =>
      recordActions.startTrainingTestAttempt(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `trainingClasses/${req.params.id}/start-test`, err);
  }
});

// POST /api/records/trainingClasses/:id/submit-test — nộp bài test của lớp học (đăng nhập bắt buộc qua
// requireAuth ở đầu file, đúng yêu cầu "cần đăng nhập để tránh làm hộ"). Khoá theo classId+username
// TRONG SUỐT lúc đọc-kiểm tra-chấm-ghi (đọc trainingTestSubmissions để chặn nộp lần 2, đọc/khoá riêng
// đúng 1 dòng trainingRegistrations để ghi kết quả) — chặn đúng race 2 request nộp bài cùng lúc của
// CHÍNH người đó (vd double-click nút Nộp Bài).
router.post('/trainingClasses/:id/submit-test', async (req, res) => {
  const classId = Number(req.params.id);
  if (!Number.isFinite(classId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withAppLock(`training_test_submission:${classId}:${freshUser.username}`, async () => {
      const classes = await getAllForCollection('trainingClasses');
      const cls = classes.find(c => c.id === classId);
      if (!cls) throw new HttpError(404, 'Không tìm thấy lớp học');
      if (cls.testId == null) throw new HttpError(400, 'Lớp học này chưa được gán bài test');

      const tests = await getAllForCollection('trainingTests');
      const test = tests.find(t => t.id === cls.testId);
      if (!test) throw new HttpError(404, 'Không tìm thấy bài test được gán cho lớp học này');

      const existingSubs = await getAllForCollection('trainingTestSubmissions');
      if (existingSubs.some(s => s.classId === classId && s.username === freshUser.username)) {
        throw new HttpError(409, 'Bạn đã làm bài test của lớp học này rồi — mỗi người chỉ được làm 1 lần duy nhất');
      }

      const regs = await getAllForCollection('trainingRegistrations');
      const reg = regs.find(r => r.classId === classId && r.creator === freshUser.username && r.result !== 'CANCELLED');
      if (!reg) throw new HttpError(403, 'Bạn chưa đăng ký lớp học này nên không thể làm bài test');

      // Đợt 9 — "học xong mới thi", áp dụng khác nhau theo kiểu lớp: OFFLINE phải chờ giảng viên bấm
      // "Kết Thúc Lớp" (cls.sessionState chuyển ENDED, xem endOfflineTrainingClass()) — trước đây route
      // này KHÔNG hề kiểm tra sessionState dù comment ở routes/trainingRoster.js (mã QR) từng khẳng định
      // có, khiến học viên quét mã QR làm bài được ngay cả khi buổi học còn đang diễn ra. ONLINE phải xem
      // hết giáo trình bắt buộc (cls.documentIds, đánh dấu qua markTrainingDocumentViewed()) nếu lớp có
      // gán giáo trình — lớp không gán giáo trình nào thì không có gì để gác thêm, giữ nguyên hành vi cũ
      // (chỉ cần qua endTime).
      if (cls.mode === 'OFFLINE') {
        if (cls.sessionState !== 'ENDED') {
          throw new HttpError(409, 'Buổi học chưa kết thúc — giảng viên cần bấm "Kết Thúc Lớp" trước khi học viên làm bài test');
        }
      } else {
        const requiredDocIds = Array.isArray(cls.documentIds) ? cls.documentIds : [];
        const viewedIds = Array.isArray(reg.viewedDocumentIds) ? reg.viewedDocumentIds : [];
        if (requiredDocIds.length && !requiredDocIds.every(id => viewedIds.includes(id))) {
          throw new HttpError(409, 'Bạn cần xem hết tài liệu giáo trình bắt buộc của lớp học trước khi làm bài test');
        }
      }

      const graded = recordActions.gradeTrainingTestSubmission(req.body?.answers, test, cls.passScore);

      // Giới hạn thời gian (cls.testSecondsPerQuestion) — đối chiếu với mốc reg.testStartedAt do route
      // .../start-test ghi lại. CỐ Ý chỉ GẮN CỜ + ghi log, KHÔNG chặn nộp bài: xem giải thích đầy đủ ở
      // evaluateTrainingTestTiming() (lib/recordActions.js) — luồng hợp lệ hiện tại cho phép thoát giữa
      // chừng rồi vào làm lại từ đầu nên chặn cứng sẽ khoá oan học viên làm thật. Bản ghi nộp bài từ nay
      // luôn kèm số giây thực tế để người quản lý đào tạo tự rà.
      const timing = recordActions.evaluateTrainingTestTiming(reg, cls, test);
      if (timing?.overTimeLimit) {
        console.warn(`[training-test] Nộp bài QUÁ GIỜ: lớp ${cls.code || cls.id}, người nộp ${freshUser.username}, ` +
          `làm ${timing.elapsedSeconds}s / giới hạn ${timing.limitSeconds}s (+${timing.graceSeconds}s biên)`);
      }

      const submission = {
        id: Date.now(),
        testId: test.id, testTitle: test.title,
        classId: cls.id, className: cls.title, classCode: cls.code,
        username: freshUser.username, name: freshUser.name, dept: freshUser.dept,
        answers: graded.answers, score: graded.score, totalPoints: graded.totalPoints,
        percentage: graded.percentage, passed: graded.passed,
        // gradingStatus (Đợt 10 — câu hỏi Nghị Luận/ESSAY): 'COMPLETE' behaves y hệt trước Đợt 10 (không
        // có câu ESSAY nào — percentage/passed đã chốt ngay ở trên). 'PENDING_ESSAY_GRADING' nghĩa là bài
        // test có ≥1 câu ESSAY CHƯA được chấm tay — percentage/passed ở trên đang là null, KHÔNG được gọi
        // applyAutoGradedTestResult() ngay bên dưới (xem nhánh if), phải chờ
        // POST .../submissions/:id/grade-essay (recordActions.gradeTrainingTestEssayAnswers()) chốt lại.
        gradingStatus: graded.gradingStatus,
        essayGradedBy: null, essayGradedByName: null, essayGradedAt: null,
        startedAt: timing?.startedAt || null,
        elapsedSeconds: timing ? timing.elapsedSeconds : null,
        timeLimitSeconds: timing ? timing.limitSeconds : null,
        overTimeLimit: timing ? timing.overTimeLimit : null,
        submittedAt: new Date().toLocaleString('vi-VN')
      };
      const insertedSubmission = await insertRecord('trainingTestSubmissions', submission);
      // Đợt 10 — CHỈ ghi kết quả Đạt/Không Đạt của LỚP HỌC ngay khi bài test KHÔNG có câu Nghị Luận nào
      // (gradingStatus 'COMPLETE', hành vi giữ NGUYÊN 100% như trước tính năng này). Có câu Nghị Luận thì
      // đăng ký (reg) GIỮ NGUYÊN 'REGISTERED' — chưa có kết quả — cho tới khi chấm tay xong (xem route
      // .../submissions/:id/grade-essay bên dưới, gọi applyAutoGradedTestResult() lúc đó).
      const updatedReg = graded.gradingStatus === 'COMPLETE'
        ? await withLockedRecordForCollection('trainingRegistrations', reg.id, (item) =>
            recordActions.applyAutoGradedTestResult(item, graded))
        : reg;

      return { submission: insertedSubmission, registration: updatedReg };
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    handleError(res, `trainingClasses/${req.params.id}/submit-test`, err);
  }
});

// POST /api/records/trainingClasses/:classId/submissions/:submissionId/grade-essay — Đợt 10: chấm tay
// PHẦN NGHỊ LUẬN (câu hỏi type ESSAY) của 1 bài đã nộp đang gradingStatus 'PENDING_ESSAY_GRADING' (xem
// gradeTrainingTestSubmission()/gradeTrainingTestEssayAnswers(), lib/recordActions.js). Khoá theo
// submissionId TRONG SUỐT lúc đọc-chấm-ghi (cùng nguyên tắc submit-test ở trên) — chặn race 2 giảng viên
// chấm cùng 1 bài cùng lúc. Body: { essayGrades: [{questionId, pointsAwarded}] } — PHẢI có đủ điểm cho
// MỌI câu ESSAY của bài test trong CÙNG 1 lượt gọi (không cho chấm dở dang, xem hàm mutator).
router.post('/trainingClasses/:classId/submissions/:submissionId/grade-essay', async (req, res) => {
  const classId = Number(req.params.classId);
  const submissionId = Number(req.params.submissionId);
  if (!Number.isFinite(classId) || !Number.isFinite(submissionId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withAppLock(`training_test_essay_grade:${submissionId}`, async () => {
      const classes = await getAllForCollection('trainingClasses');
      const cls = classes.find(c => c.id === classId);
      if (!cls) throw new HttpError(404, 'Không tìm thấy lớp học');

      const tests = await getAllForCollection('trainingTests');
      const test = tests.find(t => t.id === cls.testId);
      if (!test) throw new HttpError(404, 'Không tìm thấy bài test được gán cho lớp học này');

      const updatedSubmission = await withLockedRecordForCollection('trainingTestSubmissions', submissionId, (sub) => {
        if (sub.classId !== classId) throw new HttpError(404, 'Bài làm này không thuộc lớp học đang thao tác');
        return recordActions.gradeTrainingTestEssayAnswers(freshUser, sub, test, cls, req.body?.essayGrades);
      });

      const regs = await getAllForCollection('trainingRegistrations');
      const reg = regs.find(r => r.classId === classId && r.creator === updatedSubmission.username && r.result !== 'CANCELLED');
      if (!reg) throw new HttpError(404, 'Không tìm thấy đăng ký tương ứng để ghi kết quả cuối cùng');
      const updatedReg = await withLockedRecordForCollection('trainingRegistrations', reg.id, (item) =>
        recordActions.applyAutoGradedTestResult(item, updatedSubmission, { gradedByEssay: { username: freshUser.username, name: freshUser.name } }));

      return { submission: updatedSubmission, registration: updatedReg };
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    handleError(res, `trainingClasses/${req.params.classId}/submissions/${req.params.submissionId}/grade-essay`, err);
  }
});

// ===================== TUYỂN DỤNG (thay thế mục "Khen Thưởng" cũ) =====================
router.post('/recruitmentJobs/:id/delete', (req, res) => deleteAdminOnly(req, res, 'recruitmentJobs'));

router.post('/recruitmentJobs/:id/close', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('recruitmentJobs', itemId, (item) =>
      recordActions.closeRecruitmentJob(req.body, freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `recruitmentJobs/${req.params.id}/close`, err);
  }
});

// Đợt 2: Bản Tin Tuyển Dụng — "Xác Nhận Đã Tuyển Đủ" (OPEN -> FILLED), cùng khuôn /close ở trên.
router.post('/recruitmentJobs/:id/confirm-filled', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('recruitmentJobs', itemId, (item) =>
      recordActions.confirmRecruitmentJobFilled(req.body, freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `recruitmentJobs/${req.params.id}/confirm-filled`, err);
  }
});

router.post('/recruitmentReferrals/:id/set-status', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('recruitmentReferrals', itemId, (item) =>
      recordActions.setRecruitmentReferralStatus(req.body, freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `recruitmentReferrals/${req.params.id}/set-status`, err);
  }
});

// "Xác nhận" 1 nhân viên hoàn thành 1 CẤP BẬC (stageIndex) của lộ trình thăng tiến (Đợt 7) — cùng khuôn
// /contracts/:id/start-payment ở trên (mutatorFn vừa xác thực (đủ điều kiện PASSED hết các chương trình
// bắt buộc của ĐÚNG cấp bậc này + cấp trước đó đã được xác nhận) vừa trả bản NHÁP, PHẢI insert thêm vào
// collection careerPathConfirmations riêng ngay sau khi khoá careerPaths nhả ra).
router.post('/careerPaths/:id/confirm', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const allRegs = await getAllForCollection('trainingRegistrations');
    const existingConfirmations = await getAllForCollection('careerPathConfirmations');
    // Cần tra cứu chéo classId -> courseId (stage.requiredCourseIds trỏ vào chương trình, không phải
    // lớp cụ thể — xem confirmCareerPathForEmployee()).
    const trainingClasses = await getAllForCollection('trainingClasses');
    let draft = null;
    const result = await withLockedRecordForCollection('careerPaths', itemId, (item) => {
      draft = recordActions.confirmCareerPathForEmployee(req.body, freshUser, item, allRegs, existingConfirmations, users, trainingClasses);
      return item;
    });
    const confirmation = await createForCollection('careerPathConfirmations', () => ({ ...draft, id: Date.now() }));
    res.json({ ok: true, item: result, confirmation });
  } catch (err) {
    handleError(res, `careerPaths/${req.params.id}/confirm`, err);
  }
});

// POST /api/records/vppPeriods/:id/close — người quản lý VPP (hoặc admin) tự kết thúc kỳ sớm.
router.post('/vppPeriods/:id/close', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('vppPeriods', itemId, (item) =>
      recordActions.closeVppPeriod(freshUser, item)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `vppPeriods/${req.params.id}/close`, err);
  }
});

// ===================== "BỔ SUNG" — sửa lại + gửi lại sau khi bị người duyệt yêu cầu bổ sung =====================
// Sau khi người duyệt bấm "Bổ Sung" (POST /api/workflow/<module>/:id/request-changes, xem
// lib/workflowEngine.js), hồ sơ về NHÁP — 4 cặp route dưới đây (update/submit) cùng khuôn
// vppRegistrations/budgetEntries phía dưới, chỉ khác: KHÔNG cần đọc thêm "kỳ" nào (docs/carRegs/
// officeReqs/submissions không có khái niệm kỳ đăng ký).
router.post('/docs/:id/update', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    // appData: chỉ để đối chiếu lại trường bắt buộc của Biểu Mẫu (formTemplates) đúng như lúc TẠO —
    // xem lib/recordActions.js editDocDraft(). Đọc TRƯỚC khi khoá bản ghi (cùng khuôn route
    // /submissions/:id/update bên dưới, không giữ khoá trong lúc chờ I/O khác).
    const appData = await getAllAppData();
    const result = await withLockedRecordForCollection('docs', itemId, (item) => recordActions.editDocDraft(req.body, freshUser, item, appData));
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `docs/${req.params.id}/update`, err); }
});
router.post('/docs/:id/submit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('docs', itemId, (item) => recordActions.submitDocDraft(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `docs/${req.params.id}/submit`, err); }
});

router.post('/carRegs/:id/update', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const appData = await getAllAppData(); // formTemplates — xem route /docs/:id/update ở trên
    const result = await withLockedRecordForCollection('carRegs', itemId, (item) => recordActions.editCarRegDraft(req.body, freshUser, item, appData));
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `carRegs/${req.params.id}/update`, err); }
});
router.post('/carRegs/:id/submit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('carRegs', itemId, (item) => recordActions.submitCarRegDraft(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `carRegs/${req.params.id}/submit`, err); }
});

router.post('/officeReqs/:id/update', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const appData = await getAllAppData(); // formTemplates — xem route /docs/:id/update ở trên
    const result = await withLockedRecordForCollection('officeReqs', itemId, (item) => recordActions.editOfficeReqDraft(req.body, freshUser, item, appData));
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `officeReqs/${req.params.id}/update`, err); }
});
router.post('/officeReqs/:id/submit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('officeReqs', itemId, (item) => recordActions.submitOfficeReqDraft(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `officeReqs/${req.params.id}/submit`, err); }
});

// submissions: editSubmissionDraft() cần appData (dựng lại effectiveSteps/effectiveApprovers nếu loại/
// phòng ban/lớp phê duyệt bổ sung đổi khi sửa) — đọc 1 lần trước khi khoá bản ghi, cùng khuôn route
// /contracts/:id/edit ở trên.
router.post('/submissions/:id/update', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const appData = await getAllAppData();
    const result = await withLockedRecordForCollection('submissions', itemId, (item) => recordActions.editSubmissionDraft(req.body, freshUser, item, appData));
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `submissions/${req.params.id}/update`, err); }
});
router.post('/submissions/:id/submit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('submissions', itemId, (item) => recordActions.submitSubmissionDraft(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `submissions/${req.params.id}/submit`, err); }
});

// POST /api/records/vppRegistrations/:id/submit — "Gửi": NHÁP -> CHỜ DUYỆT (bắt đầu bước 1). Chỉ
// chính người tạo hồ sơ mới gửi được (xem lib/recordActions.js submitVppRegistration).
router.post('/vppRegistrations/:id/submit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const periods = await getAllForCollection('vppPeriods');
    const result = await withLockedRecordForCollection('vppRegistrations', itemId, (item) => {
      const period = periods.find(p => p.id === item.periodId);
      return recordActions.submitVppRegistration(freshUser, item, period);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `vppRegistrations/${req.params.id}/submit`, err);
  }
});

// POST /api/records/vppRegistrations/:id/update — sửa lại mặt hàng/số lượng khi hồ sơ còn NHÁP. Cần
// đọc lại kỳ đăng ký (vppPeriods) để xác thực danh mục/thời hạn hiện tại — vppPeriods đã chuyển sang
// dbo.Records (không có sẵn trong appData chung) nên tự đọc riêng, giống routes/create.js đã làm cho
// tạo mới vppRegistrations.
router.post('/vppRegistrations/:id/update', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const periods = await getAllForCollection('vppPeriods');
    const result = await withLockedRecordForCollection('vppRegistrations', itemId, (item) => {
      const period = periods.find(p => p.id === item.periodId);
      return recordActions.updateVppRegistrationDraft(freshUser, item, req.body, period);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `vppRegistrations/${req.params.id}/update`, err);
  }
});

// ===================== BÁO CÁO ĐỊNH KỲ =====================

// POST /api/records/reportPeriods/:id/close — người quản lý (reportManage/admin) tự đóng kỳ sớm.
router.post('/reportPeriods/:id/close', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('reportPeriods', itemId, (item) =>
      recordActions.closeReportPeriod(freshUser, item)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportPeriods/${req.params.id}/close`, err);
  }
});

// POST /api/records/reportPeriods/:id/merge — người có quyền reportAggregate/admin chọn + sắp thứ tự
// các báo cáo SUBMITTED của kỳ, dựng bản tổng hợp. Body: { entryIds: [id,...] } (đúng thứ tự đã chọn).
router.post('/reportPeriods/:id/merge', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const entries = await getAllForCollection('reportEntries');
    const result = await withLockedRecordForCollection('reportPeriods', itemId, (item) =>
      recordActions.mergeReportPeriod(freshUser, item, req.body?.entryIds, entries)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportPeriods/${req.params.id}/merge`, err);
  }
});

// POST /api/records/reportPeriods/:id/mergeByTasks — CÁCH THỨ 2 để dựng bản tổng hợp của kỳ, tự động
// từ module Công Việc (DB.tasks) thay vì các reportEntries do từng phòng gửi — body optional
// { status?, fromDate?, toDate? } lọc thêm/ghi đè mốc thời gian, mọi logic lọc phạm vi/thời gian nằm ở
// lib/recordActions.js (mergeReportPeriodByTasks).
router.post('/reportPeriods/:id/mergeByTasks', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const tasks = await getAllTasks();
    const allPeriods = await getAllForCollection('reportPeriods');
    let boundaryGapWarning = null;
    const result = await withLockedRecordForCollection('reportPeriods', itemId, (item) => {
      const { period, warning } = recordActions.mergeReportPeriodByTasks(freshUser, item, tasks, users, allPeriods, req.body);
      boundaryGapWarning = warning;
      return period;
    });
    res.json({ ok: true, item: result, warning: boundaryGapWarning });
  } catch (err) {
    handleError(res, `reportPeriods/${req.params.id}/mergeByTasks`, err);
  }
});

// POST /api/records/reportPeriods/:id/compilation — sửa slide (nội dung/thứ tự) khi bản tổng hợp còn
// đang MERGED (chưa phát hành). Body: { slides: [{kind, title, ...}, ...] } theo đúng thứ tự — field
// theo từng kind xem updateReportCompilation() ở lib/recordActions.js.
router.post('/reportPeriods/:id/compilation', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('reportPeriods', itemId, (item) =>
      recordActions.updateReportCompilation(freshUser, item, req.body?.slides)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportPeriods/${req.params.id}/compilation`, err);
  }
});

router.post('/reportPeriods/:id/publish', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('reportPeriods', itemId, (item) =>
      recordActions.publishReportPeriod(freshUser, item)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportPeriods/${req.params.id}/publish`, err);
  }
});

router.post('/reportPeriods/:id/unpublish', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('reportPeriods', itemId, (item) =>
      recordActions.unpublishReportPeriod(freshUser, item)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportPeriods/${req.params.id}/unpublish`, err);
  }
});

// ===== Tổng hợp/phát hành bằng GHÉP FILE PDF THẬT (reportEntries.entryType==='PDF') — 3 route SONG
// SONG với merge/compilation/publish/unpublish ở trên (dựng từ .pptx), xem chú thích đầu
// mergeReportPeriodPdf() ở lib/recordActions.js. =====
router.post('/reportPeriods/:id/mergePdf', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const entries = await getAllForCollection('reportEntries');
    const result = await withLockedRecordForCollection('reportPeriods', itemId, (item) =>
      recordActions.mergeReportPeriodPdf(freshUser, item, req.body?.entryIds, req.body?.pages, entries)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportPeriods/${req.params.id}/mergePdf`, err);
  }
});

// publish thật sự ghép byte PDF (đọc file/pdf-lib/đóng dấu) NGAY TRONG transaction khoá của
// withLockedRecordForCollection — collection này nằm trong MIGRATED_COLLECTIONS nên mutator chạy qua
// withLockedRecordById() (lib/recordStore.js), có `await mutatorFn(item)` trong 1 transaction SQL thật
// (UPDLOCK, HOLDLOCK) — mutator async ở đây an toàn, tự chặn race giữa 2 lượt merge/publish chồng nhau.
router.post('/reportPeriods/:id/publishPdf', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const entries = await getAllForCollection('reportEntries');
    const result = await withLockedRecordForCollection('reportPeriods', itemId, (item) =>
      recordActions.publishReportPeriodPdf(freshUser, item, entries)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportPeriods/${req.params.id}/publishPdf`, err);
  }
});

router.post('/reportPeriods/:id/unpublishPdf', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('reportPeriods', itemId, (item) =>
      recordActions.unpublishReportPeriodPdf(freshUser, item)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportPeriods/${req.params.id}/unpublishPdf`, err);
  }
});

// POST /api/records/reportEntries/:id/submit — "Gửi": NHÁP -> SUBMITTED, chốt hẳn.
router.post('/reportEntries/:id/submit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const periods = await getAllForCollection('reportPeriods');
    const result = await withLockedRecordForCollection('reportEntries', itemId, (item) => {
      const period = periods.find(p => p.id === item.periodId);
      return recordActions.submitReportEntry(freshUser, item, period);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportEntries/${req.params.id}/submit`, err);
  }
});

// POST /api/records/reportEntries/:id/update — sửa tiêu đề/nội dung khi báo cáo còn NHÁP.
router.post('/reportEntries/:id/update', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const periods = await getAllForCollection('reportPeriods');
    const result = await withLockedRecordForCollection('reportEntries', itemId, (item) => {
      const period = periods.find(p => p.id === item.periodId);
      return recordActions.updateReportEntryDraft(freshUser, item, req.body, period);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `reportEntries/${req.params.id}/update`, err);
  }
});

// ===================== NGÂN SÁCH =====================

// POST /api/records/budgetPeriods/:id/close — người quản lý (budgetManage/admin) tự đóng kỳ sớm.
router.post('/budgetPeriods/:id/close', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('budgetPeriods', itemId, (item) =>
      recordActions.closeBudgetPeriod(freshUser, item)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `budgetPeriods/${req.params.id}/close`, err);
  }
});

// POST /api/records/budgetPeriods/:id/reopen — mở lại kỳ đã đóng, bắt buộc body { endTime } (hạn chót mới).
router.post('/budgetPeriods/:id/reopen', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('budgetPeriods', itemId, (item) =>
      recordActions.reopenBudgetPeriod(freshUser, item, req.body?.endTime)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `budgetPeriods/${req.params.id}/reopen`, err);
  }
});

// POST /api/records/budgetEntries/:id/submit — "Gửi": NHÁP -> PENDING (bắt đầu duyệt Trưởng phòng).
router.post('/budgetEntries/:id/submit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const periods = await getAllForCollection('budgetPeriods');
    const result = await withLockedRecordForCollection('budgetEntries', itemId, (item) => {
      const period = periods.find(p => p.id === item.periodId);
      return recordActions.submitBudgetEntry(freshUser, item, period);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `budgetEntries/${req.params.id}/submit`, err);
  }
});

// POST /api/records/budgetEntries/:id/update — sửa các dòng ngân sách khi bản còn NHÁP.
router.post('/budgetEntries/:id/update', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const periods = await getAllForCollection('budgetPeriods');
    const templates = await getAllForCollection('budgetTemplates');
    const result = await withLockedRecordForCollection('budgetEntries', itemId, (item) => {
      const period = periods.find(p => p.id === item.periodId);
      return recordActions.updateBudgetEntryDraft(freshUser, item, req.body, period, templates);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `budgetEntries/${req.params.id}/update`, err);
  }
});

// POST /api/records/budgetEntries/:id/manager-edit — budgetManage/admin sửa TRỰC TIẾP 1 bản Ngân Sách
// Thực Hiện (entryKind='ACTUAL') BẤT KỂ trạng thái (không cần bản đang NHÁP, không giới hạn phòng ban
// của người sửa) — xem recordActions.updateApprovedActualBudgetEntry(). ACTUAL không còn qua phê duyệt
// Trưởng phòng nên đây là kênh DUY NHẤT để sửa lại số liệu sau khi đã ghi nhận.
router.post('/budgetEntries/:id/manager-edit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const periods = await getAllForCollection('budgetPeriods');
    const templates = await getAllForCollection('budgetTemplates');
    const result = await withLockedRecordForCollection('budgetEntries', itemId, (item) => {
      const period = periods.find(p => p.id === item.periodId);
      return recordActions.updateApprovedActualBudgetEntry(freshUser, item, req.body, period, templates);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `budgetEntries/${req.params.id}/manager-edit`, err);
  }
});

// Vận Hành — cùng khuôn officeReqs/carRegs update+submit ở trên (chỉ người tạo sửa được lúc còn NHÁP,
// "Gửi" đẩy về PENDING bước 1).
router.post('/operationOrders/:id/update', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('operationOrders', itemId, (item) => recordActions.editOperationOrderDraft(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `operationOrders/${req.params.id}/update`, err); }
});
router.post('/operationOrders/:id/submit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('operationOrders', itemId, (item) => recordActions.submitOperationOrderDraft(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `operationOrders/${req.params.id}/submit`, err); }
});
// "Nhập Hàng"/"Hủy Nhập" (đợt "Báo Cáo + Nhập Hàng") — CHỈ nhận từ AWAITING_RECEIPT (giai đoạn
// applyWorkflowAction() ở lib/workflowEngine.js tự chuyển sang ngay sau khi duyệt xong bước cuối), hoàn
// toàn TÁCH RIÊNG khỏi route generic POST /api/workflow/operationOrders/:id/:action (route đó chỉ nhận
// PENDING, xem đầu applyWorkflowAction()) — không đụng gì tới quy trình duyệt phòng ban cũ. appData cần
// cho recordActions.isApproverForOperationOrderReceipt() tra lại đúng dept-workflow của hồ sơ.
router.post('/operationOrders/:id/receive-goods', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const appData = await getAllAppData();
    const result = await withLockedRecordForCollection('operationOrders', itemId, (item) => recordActions.receiveOperationOrderGoods(freshUser, item, appData));
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `operationOrders/${req.params.id}/receive-goods`, err); }
});
router.post('/operationOrders/:id/cancel-receipt', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const appData = await getAllAppData();
    const result = await withLockedRecordForCollection('operationOrders', itemId, (item) => recordActions.cancelOperationOrderReceipt(freshUser, item, req.body, appData));
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `operationOrders/${req.params.id}/cancel-receipt`, err); }
});
// operationStoreOpenings/operationRepairs KHÔNG còn route update/submit "Bổ Sung" (đã xoá cùng đợt bỏ
// hẳn phê duyệt Vận Hành > Siêu Thị — Mục H, 60c473b) — status của 2 collection này giờ đi thẳng
// APPROVED ngay lúc tạo, KHÔNG BAO GIỜ vào lại DRAFT nữa (migrateStuckOperationApprovalStatuses() ở
// seedDefaults.js đã quét sạch mọi bản ghi DRAFT còn sót từ trước Mục H mỗi lần khởi động), nên
// editOperationStoreOpeningDraft/submitOperationStoreOpeningDraft/editOperationRepairDraft/
// submitOperationRepairDraft (lib/recordActions.js) không còn đường gọi tới — đã xoá cùng route này.

// QUYẾT ĐỊNH THIẾT KẾ — quan hệ Danh mục đầu tư ↔ Công việc (yêu cầu người dùng: "danh mục đầu tư lập
// xong có thể sửa để thêm bớt công việc, tự động cập nhật sang nghiệm thu", không nói rõ cơ chế cụ thể):
// CÂN NHẮC rồi CHỦ ĐÍCH KHÔNG tự tạo/xoá công việc Thực hiện theo từng hạng mục Danh mục đầu tư (dù đã
// thử — xem lịch sử commit — nhưng gây tác dụng phụ 2 chiều nguy hiểm: (1) hồ sơ CŨ đã có sẵn Danh mục
// đầu tư trước tính năng này, chỉ cần sửa nhỏ (thêm 1 hạng mục) cũng bất ngờ sinh ra công việc "ma" cho
// TOÀN BỘ hạng mục cũ; (2) "Danh mục đầu tư" (hạng mục ngân sách/chi phí) và "Công việc" (đầu việc thi
// công thực tế, có cây cha/con) thường khác NHAU về mức độ chi tiết — 1 hạng mục ngân sách có thể ứng
// với 0, 1, hay nhiều công việc, ép đúng 1-1 sẽ SAI với thực tế vận hành). Thay vào đó, "tự động cập
// nhật" được hiểu là: MỌI thứ hiển thị suy ra từ Danh mục đầu tư (trạng thái vòng đời hiển thị ở
// operationRecordStageStatus()/computeOperationRecordStageStatus(), "Ngân sách còn lại") đều tính TRỰC
// TIẾP từ estimateItems/estimateStatus mỗi lần hiển thị — sửa danh mục xong là các số này tự đúng NGAY,
// không cần bước đồng bộ thủ công nào. Công việc (Thực hiện) tiếp tục là 1 cây độc lập, tự thêm/xoá tay
// như trước — không đổi.
//
// Vận Hành > "Siêu Thị" > Giai đoạn Danh mục đầu tư — lưu/lưu lại bảng hạng mục (KHÔNG còn qua duyệt,
// CÓ THỂ lưu lại nhiều lần kể cả sau khi đã APPROVED — xem lib/recordActions.js submitOperationEstimate()).
// recordActions.submitOperationEstimate dùng CHUNG cho cả 2 collection.
router.post('/operationStoreOpenings/:id/estimate/submit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('operationStoreOpenings', itemId, (item) => recordActions.submitOperationEstimate(freshUser, item, req.body, 'OPERATION_STORE_OPENING'));
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `operationStoreOpenings/${req.params.id}/estimate/submit`, err); }
});
router.post('/operationRepairs/:id/estimate/submit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('operationRepairs', itemId, (item) => recordActions.submitOperationEstimate(freshUser, item, req.body, 'OPERATION_REPAIR'));
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `operationRepairs/${req.params.id}/estimate/submit`, err); }
});

// Vận Hành > "Siêu Thị" > Giai đoạn Dự toán — "Lập lại" sau khi bị Từ chối (REJECTED -> DRAFT), xem
// lib/recordActions.js resetOperationEstimateToDraft() (audit Đợt 5, Giai đoạn 4).
router.post('/operationStoreOpenings/:id/estimate/reset', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('operationStoreOpenings', itemId, (item) => recordActions.resetOperationEstimateToDraft(freshUser, item, 'OPERATION_STORE_OPENING'));
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `operationStoreOpenings/${req.params.id}/estimate/reset`, err); }
});
router.post('/operationRepairs/:id/estimate/reset', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('operationRepairs', itemId, (item) => recordActions.resetOperationEstimateToDraft(freshUser, item, 'OPERATION_REPAIR'));
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `operationRepairs/${req.params.id}/estimate/reset`, err); }
});

// Vận Hành > "Siêu Thị" > Giai đoạn Thực hiện + Nghiệm thu — cây công việc đa cấp, bảng SQL RIÊNG
// (dbo.OperationWorkItems, xem lib/operationWorkItemStore.js) — KHÔNG đi qua createForCollection/
// withLockedRecordForCollection (đó là engine cho dbo.Records, dùng cho hồ sơ có quy trình duyệt).
const operationWorkItemSourceTypes = new Set(['OPERATION_STORE_OPENING', 'OPERATION_REPAIR']);

// Đệ quy tính lại trạng thái từng CẤP CHA lên tới gốc, ngay sau khi 1 công việc lá đổi trạng thái —
// mỗi cấp tự tính lại theo ĐÚNG con trực tiếp của mình (recordActions.computeParentWorkItemStatus),
// rồi tiếp tục lên cấp trên nếu trạng thái vừa tính có thay đổi. Dừng khi tới gốc (parentWorkItemId
// null) hoặc hết cha để tra.
async function syncOperationWorkItemAncestors(parentWorkItemId, sourceType, sourceId) {
  let currentParentId = parentWorkItemId;
  while (currentParentId != null) {
    const all = await getWorkItemsBySource(sourceType, sourceId);
    const parent = all.find(w => w.id === currentParentId);
    if (!parent) break;
    const children = all.filter(w => w.parentWorkItemId === currentParentId);
    const newStatus = recordActions.computeParentWorkItemStatus(children);
    if (newStatus === parent.status) break; // không đổi -> các cấp trên cũng không cần tính lại
    await withLockedWorkItemById(currentParentId, (item) => {
      item.status = newStatus;
      // Mirror updateOperationWorkItemProgress(): completedAt chỉ server tự set lúc chuyển
      // DANG_NGHIEM_THU (dùng tính "Dự Kiến Nghiệm Thu") — cha cascade tự động cũng cần mốc này, không
      // chỉ công việc lá tự tay Nộp Nghiệm Thu mới có.
      if (newStatus === 'DANG_NGHIEM_THU' && !item.completedAt) item.completedAt = new Date().toLocaleString('vi-VN');
      item.history = item.history || [];
      item.history.push({ action: `STATUS_${newStatus}`, by: 'system', byName: 'Hệ thống (tự động)', time: new Date().toLocaleString('vi-VN') });
      return item;
    });
    currentParentId = parent.parentWorkItemId;
  }
}

// VHST-5: khi xoá 1 (nhánh) công việc, dọn sạch id đã xoá khỏi dependsOnWorkItemIds[] của MỌI công việc
// KHÁC còn lại cùng hồ sơ có tham chiếu tới — tránh để lại tham chiếu "chết" (dù updateOperationWorkItemProgress()
// đã tự bỏ qua id không tìm thấy khi kiểm tra cổng chặn, xem chú thích ở đó, nhưng dữ liệu vẫn nên sạch —
// "🔗 Phụ thuộc: ..." hiển thị ở dòng công việc mà lỡ trỏ tới việc đã xoá sẽ trông như lỗi dữ liệu).
// deletedIds = TOÀN BỘ id vừa xoá (item gốc + toàn bộ con cháu, xem deleteWorkItemsByIds() ở route
// /delete ngay dưới) — sourceType/sourceId của item vừa xoá (cả nhánh xoá luôn CÙNG 1 hồ sơ, kế thừa từ
// cha, xem createOperationWorkItem()).
async function cleanupOperationWorkItemDependenciesOnDelete(deletedIds, sourceType, sourceId) {
  if (!deletedIds || !deletedIds.length) return;
  const deletedSet = new Set(deletedIds);
  const remaining = await getWorkItemsBySource(sourceType, sourceId);
  const affected = remaining.filter(w => Array.isArray(w.dependsOnWorkItemIds) && w.dependsOnWorkItemIds.some(id => deletedSet.has(id)));
  for (const w of affected) {
    await withLockedWorkItemById(w.id, (item) => {
      item.dependsOnWorkItemIds = (item.dependsOnWorkItemIds || []).filter(id => !deletedSet.has(id));
      return item;
    });
  }
}

function collectOperationWorkItemDescendantIds(all, rootId) {
  const result = [];
  const queue = all.filter(w => w.parentWorkItemId === rootId).map(w => w.id);
  while (queue.length) {
    const id = queue.shift();
    result.push(id);
    all.filter(w => w.parentWorkItemId === id).forEach(w => queue.push(w.id));
  }
  return result;
}

// Tra hồ sơ gốc (operationStoreOpenings/operationRepairs) đúng 1 work item — dùng CHUNG cho mọi route
// thao tác trên work item (edit/progress/accept/delete) cần đối chiếu "toàn quyền quản lý hồ sơ"
// (recordActions.assertCanManageOperationRecord()/canManageOperationRecord() — creator +
// operationStoreOpenCreate/operationRepairCreate, hoặc operationRecordManageAll/admin). KHÔNG cache —
// creator không đổi nhưng operationRecordManageAll/quyền người gọi có thể vừa đổi qua route sửa quyền.
async function getOperationWorkItemSourceRecord(item) {
  const sourceCollection = item.sourceType === 'OPERATION_REPAIR' ? 'operationRepairs' : 'operationStoreOpenings';
  const sourceRecords = await getAllForCollection(sourceCollection);
  return sourceRecords.find(r => r.id === item.sourceId);
}

router.post('/operationWorkItems', async (req, res) => {
  try {
    const { freshUser, users } = await getFreshUser(req);
    const { sourceType, sourceId } = req.body || {};
    if (!operationWorkItemSourceTypes.has(sourceType)) return res.status(400).json({ error: 'sourceType không hợp lệ' });
    const srcId = Number(sourceId);
    if (!Number.isFinite(srcId)) return res.status(400).json({ error: 'sourceId không hợp lệ' });
    const sourceCollection = sourceType === 'OPERATION_STORE_OPENING' ? 'operationStoreOpenings' : 'operationRepairs';
    const sourceRecords = await getAllForCollection(sourceCollection);
    const sourceRecord = sourceRecords.find(r => r.id === srcId);
    if (!sourceRecord) return res.status(404).json({ error: 'Không tìm thấy hồ sơ nguồn' });

    const siblings = await getWorkItemsBySource(sourceType, srcId);
    // Kỳ Thực Hiện đúng hồ sơ này — createOperationWorkItem() tự validate periodId (công việc gốc bắt
    // buộc chọn đúng kỳ đang "Đang thực hiện"), xem lib/createValidation.js operationExecutionPeriods.
    const allPeriods = await getAllForCollection('operationExecutionPeriods');
    const periodsForSource = allPeriods.filter(p => p.sourceType === sourceType && p.sourceId === srcId);
    const newItem = recordActions.createOperationWorkItem(freshUser, req.body, sourceRecord, siblings, periodsForSource, users, sourceType);
    newItem.sourceType = sourceType;
    newItem.sourceId = srcId;
    await insertWorkItem(newItem);
    // Audit nghiệp vụ (đợt 4): thêm việc CON mới vào 1 cha đang "Đang nghiệm thu" (cha CHƯA
    // DA_NGHIEM_THU nên createOperationWorkItem() vẫn cho phép, xem chú thích ở đó) làm cha bị "kẹt" sai
    // trạng thái — trước đây CHỈ /progress và /accept mới gọi syncOperationWorkItemAncestors(), route tạo
    // mới này thì không, nên cha không được tính lại dù tập hợp con vừa đổi. Gọi lại ngay sau khi tạo,
    // giống hệt 2 route kia — nếu không có cha (newItem.parentWorkItemId null) hàm tự no-op ở vòng lặp đầu.
    await syncOperationWorkItemAncestors(newItem.parentWorkItemId, sourceType, srcId);
    res.json({ ok: true, item: newItem });
  } catch (err) { handleError(res, 'operationWorkItems', err); }
});

// POST /api/records/operationExecutionPeriods/:id/start — "Bắt Đầu Kỳ" (CHUA_BAT_DAU -> DANG_THUC_HIEN),
// mở khoá chọn kỳ này khi tạo công việc gốc — xem lib/recordActions.js startOperationExecutionPeriod().
router.post('/operationExecutionPeriods/:id/start', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    // Cần đọc sẵn hồ sơ gốc (operationStoreOpenings/operationRepairs) để đối chiếu quyền "toàn quyền
    // quản lý hồ sơ" (assertCanManageOperationRecord() — creator + operationStoreOpenCreate/
    // operationRepairCreate, hoặc operationRecordManageAll/admin) — Kỳ Thực Hiện cũng có sẵn
    // sourceType/sourceId nên dùng lại ĐÚNG getOperationWorkItemSourceRecord() (tên hàm chung, không chỉ
    // riêng work item) thay vì lặp lại logic tra collection lần thứ 2.
    const result = await withLockedRecordForCollection('operationExecutionPeriods', itemId, async (item) => {
      const sourceRecord = await getOperationWorkItemSourceRecord(item);
      return recordActions.startOperationExecutionPeriod(freshUser, item, sourceRecord);
    });
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `operationExecutionPeriods/${req.params.id}/start`, err); }
});

router.post('/operationWorkItems/:id/progress', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const { status: newStatus, note } = req.body || {};
    let sourceType, sourceId;
    const result = await withLockedWorkItemById(itemId, async (item) => {
      sourceType = item.sourceType; sourceId = item.sourceId;
      const all = await getWorkItemsBySource(item.sourceType, item.sourceId);
      const children = all.filter(w => w.parentWorkItemId === item.id);
      // sourceRecord CHỈ dùng cho nhánh override "toàn quyền quản lý hồ sơ" — cơ chế chính assignedTo[]
      // (isOwner) không đổi, xem lib/recordActions.js updateOperationWorkItemProgress().
      const sourceRecord = await getOperationWorkItemSourceRecord(item);
      // VHST-5: truyền "all" (toàn bộ work item cùng hồ sơ, vừa đọc ở trên) làm itemsForSource cho cổng
      // chặn "🔗 Liên kết" (updateOperationWorkItemProgress() tự tra trạng thái từng công việc trong
      // item.dependsOnWorkItemIds[] qua tham số này).
      return recordActions.updateOperationWorkItemProgress(freshUser, item, children, newStatus, note, sourceRecord, all);
    });
    await syncOperationWorkItemAncestors(result.parentWorkItemId, sourceType, sourceId);
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `operationWorkItems/${req.params.id}/progress`, err); }
});

// POST /api/records/operationWorkItems/:id/edit — sửa thông tin công việc (title/mô tả/người phụ
// trách[]/người nghiệm thu chỉ định/hạn/nghiệm thu ngay-sau N ngày) — xem lib/recordActions.js
// editOperationWorkItem(). Quyền sửa nay CHỈ theo "toàn quyền quản lý hồ sơ" (đã RÚT GỌN "Người Phụ
// Trách" khỏi vai trò cấp quyền) — cần load sourceRecord (KHÔNG cache vì quyền/creator có thể vừa đổi)
// để editOperationWorkItem() tự đối chiếu.
router.post('/operationWorkItems/:id/edit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const result = await withLockedWorkItemById(itemId, async (item) => {
      const sourceRecord = await getOperationWorkItemSourceRecord(item);
      // hasChildren — cần cho editOperationWorkItem() đối chiếu Ngày bắt đầu/Tần suất cập nhật tiến độ
      // (VHST-4, CHỈ việc LÁ), cùng cách tính hasChildren dùng ở buildOperationWorkItemRows() client.
      const all = await getWorkItemsBySource(item.sourceType, item.sourceId);
      const hasChildren = all.some(w => w.parentWorkItemId === item.id);
      return recordActions.editOperationWorkItem(freshUser, item, req.body || {}, users, sourceRecord, hasChildren);
    });
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `operationWorkItems/${req.params.id}/edit`, err); }
});

// POST /api/records/operationWorkItems/:id/dependencies — VHST-5: "🔗 Liên kết" công việc (chọn nhiều
// công việc LÁ khác cùng hồ sơ mà item này PHỤ THUỘC vào — dependsOnWorkItemIds) — route sub-endpoint
// RIÊNG (mirror /edit, /progress, /accept — mỗi route chỉ đổi đúng phần dữ liệu của thao tác đó), xem
// lib/recordActions.js setOperationWorkItemDependencies().
router.post('/operationWorkItems/:id/dependencies', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedWorkItemById(itemId, async (item) => {
      const sourceRecord = await getOperationWorkItemSourceRecord(item);
      // itemsForSource/hasChildren — CÙNG cách tính dùng ở route /edit ngay trên (toàn bộ work item cùng
      // sourceType/sourceId, đối chiếu parentWorkItemId để biết item đang sửa có con hay không).
      const all = await getWorkItemsBySource(item.sourceType, item.sourceId);
      const hasChildren = all.some(w => w.parentWorkItemId === item.id);
      return recordActions.setOperationWorkItemDependencies(freshUser, item, req.body || {}, all, hasChildren, sourceRecord);
    });
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `operationWorkItems/${req.params.id}/dependencies`, err); }
});

router.post('/operationWorkItems/:id/accept', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    let sourceType, sourceId, parentWorkItemId;
    const result = await withLockedWorkItemById(itemId, async (item) => {
      sourceType = item.sourceType; sourceId = item.sourceId; parentWorkItemId = item.parentWorkItemId;
      const all = await getWorkItemsBySource(item.sourceType, item.sourceId);
      const children = all.filter(w => w.parentWorkItemId === item.id);
      // sourceRecord CHỈ dùng cho nhánh override "toàn quyền quản lý hồ sơ" — cơ chế chính
      // acceptorUsername (isOwner) không đổi, xem lib/recordActions.js acceptOperationWorkItem().
      const sourceRecord = await getOperationWorkItemSourceRecord(item);
      return recordActions.acceptOperationWorkItem(freshUser, item, children, req.body || {}, sourceRecord);
    });
    await syncOperationWorkItemAncestors(parentWorkItemId, sourceType, sourceId);
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `operationWorkItems/${req.params.id}/accept`, err); }
});

router.post('/operationWorkItems/:id/delete', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const all = await getAllWorkItems();
    const item = all.find(w => w.id === itemId);
    if (!item) return res.status(404).json({ error: 'Không tìm thấy công việc' });
    const descendantIds = collectOperationWorkItemDescendantIds(all, itemId);
    const sourceRecord = await getOperationWorkItemSourceRecord(item);
    const idsToDelete = recordActions.deleteOperationWorkItem(freshUser, item, descendantIds, sourceRecord);
    // 1 câu DELETE...WHERE Id IN (...) duy nhất (atomic) thay vì vòng lặp nhiều câu DELETE riêng lẻ —
    // xem giải thích đầy đủ ở deleteWorkItemsByIds() (lib/operationWorkItemStore.js).
    await deleteWorkItemsByIds(idsToDelete);
    // VHST-5: dọn sạch dependsOnWorkItemIds[] ở các công việc KHÁC còn lại có trỏ tới (nhánh) vừa xoá.
    await cleanupOperationWorkItemDependenciesOnDelete(idsToDelete, item.sourceType, item.sourceId);
    await syncOperationWorkItemAncestors(item.parentWorkItemId, item.sourceType, item.sourceId);
    res.json({ ok: true });
  } catch (err) { handleError(res, `operationWorkItems/${req.params.id}/delete`, err); }
});

// POST /api/records/(operationStoreOpenings|operationRepairs)/:id/confirm-use — mốc CẤP HỒ SƠ "Xác
// Nhận Đưa Vào Sử Dụng" (chỉ mở khi TOÀN BỘ cây công việc đã "Đã nghiệm thu") — xem lib/recordActions.js
// confirmOperationUse().
router.post('/operationStoreOpenings/:id/confirm-use', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('operationStoreOpenings', itemId, async (item) => {
      const workItems = await getWorkItemsBySource('OPERATION_STORE_OPENING', itemId);
      return recordActions.confirmOperationUse(freshUser, item, workItems, 'OPERATION_STORE_OPENING');
    });
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `operationStoreOpenings/${req.params.id}/confirm-use`, err); }
});

router.post('/operationRepairs/:id/confirm-use', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('operationRepairs', itemId, async (item) => {
      const workItems = await getWorkItemsBySource('OPERATION_REPAIR', itemId);
      return recordActions.confirmOperationUse(freshUser, item, workItems, 'OPERATION_REPAIR');
    });
    res.json({ ok: true, item: result });
  } catch (err) { handleError(res, `operationRepairs/${req.params.id}/confirm-use`, err); }
});

// POST /api/records/budgetTemplates/:id/update — sửa tên/cột bổ sung 1 mẫu ngân sách đã tạo.
router.post('/budgetTemplates/:id/update', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('budgetTemplates', itemId, (item) =>
      recordActions.updateBudgetTemplate(freshUser, item, req.body)
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `budgetTemplates/${req.params.id}/update`, err);
  }
});

// ===================== HỖ TRỢ IT =====================
router.post('/itPriceApprovals/:id/delete', (req, res) => deleteAdminOnly(req, res, 'itPriceApprovals'));

// "Xác nhận đã áp giá" — sau khi đề xuất đã APPROVED (qua POST /api/workflow/itPriceApprovals/:id/approve,
// dùng chung engine với docs/carRegs), người Hỗ Trợ IT áp giá vào hệ thống bán hàng ngoài app rồi bấm
// xác nhận NGAY TẠI ĐÂY — route riêng, không đi qua routes/workflow.js vì đây không phải 1 bước duyệt.
router.post('/itPriceApprovals/:id/apply', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itPriceApprovals', itemId, (item) =>
      recordActions.applyPriceApproval(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itPriceApprovals/${req.params.id}/apply`, err);
  }
});

// "Tôi đang xử lý" — 1 người trong đội Hỗ Trợ IT khoá đề xuất này về mình trước khi áp giá, để
// chỉ chính người đó (hoặc admin) mới xác nhận hoàn thành được sau này (xem claimPriceApply()).
router.post('/itPriceApprovals/:id/claim-apply', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itPriceApprovals', itemId, (item) =>
      recordActions.claimPriceApply(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itPriceApprovals/${req.params.id}/claim-apply`, err);
  }
});

// Huỷ nhận xử lý — trả đề xuất về hàng đợi chung cho người khác trong đội nhận lại (xem
// releasePriceApplyClaim()).
router.post('/itPriceApprovals/:id/release-apply-claim', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itPriceApprovals', itemId, (item) =>
      recordActions.releasePriceApplyClaim(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itPriceApprovals/${req.params.id}/release-apply-claim`, err);
  }
});

// "Yêu Cầu Bổ Sung" từ đội Hỗ Trợ IT (sau khi đã APPROVED, trước khi áp giá) — dùng chung
// item.infoRequests với nhánh REQUEST_INFO của người duyệt phòng ban (POST /api/workflow/
// itPriceApprovals/:id/request-info, xem lib/workflowEngine.js).
router.post('/itPriceApprovals/:id/request-info', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itPriceApprovals', itemId, (item) =>
      recordActions.requestPriceInfoFromIt(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itPriceApprovals/${req.params.id}/request-info`, err);
  }
});

// Người đề xuất tải lên tệp bổ sung để phản hồi 1 yêu cầu bổ sung đang chờ (từ CẢ 2 nguồn approver/IT)
// — tệp mới được THÊM VÀO, không thay thế tệp trước đó (xem submitPriceSupplementFile()).
router.post('/itPriceApprovals/:id/submit-supplement', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itPriceApprovals', itemId, (item) =>
      recordActions.submitPriceSupplementFile(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itPriceApprovals/${req.params.id}/submit-supplement`, err);
  }
});

// "Từ chối khẩn cấp" — người đã duyệt bước cuối cùng đổi ý SAU khi đã duyệt (APPROVED), TRƯỚC khi IT
// áp giá thật — gửi yêu cầu cho người có quyền itPriceEmergencyRejectApprove xét duyệt (xem
// requestItPriceEmergencyReject()/approveItPriceEmergencyReject()/denyItPriceEmergencyReject() ở
// lib/recordActions.js). Được duyệt -> hồ sơ REJECTED giống hệt bị từ chối bước thường.
router.post('/itPriceApprovals/:id/request-emergency-reject', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itPriceApprovals', itemId, (item) =>
      recordActions.requestItPriceEmergencyReject(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itPriceApprovals/${req.params.id}/request-emergency-reject`, err);
  }
});

router.post('/itPriceApprovals/:id/approve-emergency-reject', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itPriceApprovals', itemId, (item) =>
      recordActions.approveItPriceEmergencyReject(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itPriceApprovals/${req.params.id}/approve-emergency-reject`, err);
  }
});

router.post('/itPriceApprovals/:id/deny-emergency-reject', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itPriceApprovals', itemId, (item) =>
      recordActions.denyItPriceEmergencyReject(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itPriceApprovals/${req.params.id}/deny-emergency-reject`, err);
  }
});

router.post('/itSupportTickets/:id/delete', (req, res) => deleteAdminOnly(req, res, 'itSupportTickets'));

router.post('/itSupportTickets/:id/claim', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itSupportTickets', itemId, (item) =>
      recordActions.claimItTicket(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itSupportTickets/${req.params.id}/claim`, err);
  }
});

router.post('/itSupportTickets/:id/update-status', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itSupportTickets', itemId, (item) =>
      recordActions.updateItTicketStatus(freshUser, item, req.body));
    // Ticket sinh ra từ 1 task nhãn IT trong quy trình Nhân Sự > Onboarding/Offboarding (sourceType, xem
    // createItTicketForHrTask() ở lib/recordActions.js) vừa chuyển DONE -> ghi lại kết quả IT báo cáo
    // (resolutionNote) ngược về ĐÚNG task (qua sourceTaskId) đã sinh ra ticket này. update-status chỉ
    // chuyển DONE ĐÚNG 1 lần (chặn sửa tiếp sau DONE/CANCELLED, xem updateItTicketStatus()) nên nhánh
    // này không chạy lặp. KHÔNG BAO GIỜ GHI vào DB.users ở đây — chỉ ĐỌC (đã có sẵn `users` từ
    // getFreshUser() ở trên, không thêm truy vấn nào) để cổng người-kế-nhiệm trong
    // computeHrProcessProgress() (xem lib/recordActions.js) hoạt động đúng cả trên nhánh phụ này, phòng
    // trường hợp chính task IT (VD "Vô hiệu hoá tài khoản") lại là task cuối cùng khiến Offboarding đủ
    // điều kiện tự Hoàn Tất. Lỗi ở bước ghi ngược (hiếm — hồ sơ liên kết đã bị xoá...) KHÔNG làm hỏng
    // việc IT vừa hoàn tất ticket (đã commit xong ở bước trên) — chỉ log lại để tra cứu sau, cùng tinh
    // thần learnLicenseType() ở routes/create.js (tiện ích phụ không được phép làm hỏng thao tác chính
    // đã thành công).
    if (result.status === 'DONE' && result.sourceType && result.sourceId != null) {
      const linkedCollection = recordActions.HR_LIFECYCLE_TICKET_SOURCE_COLLECTION[result.sourceType];
      if (linkedCollection) {
        try {
          const linkedItem = await withLockedRecordForCollection(linkedCollection, result.sourceId, (item) =>
            recordActions.applyItTicketCompletionToHrProcessTask(freshUser, item, result, users));
          await syncEmployeeProfileOnHrCompletion(linkedItem, `itSupportTickets/${itemId}/update-status`);
        } catch (linkErr) {
          console.error(`itSupportTickets/${itemId}/update-status: lỗi ghi ngược hồ sơ ${linkedCollection}/${result.sourceId}:`, linkErr.message);
        }
      }
    }
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itSupportTickets/${req.params.id}/update-status`, err);
  }
});

router.post('/itSupportTickets/:id/comment', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itSupportTickets', itemId, (item) =>
      recordActions.addItTicketComment(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itSupportTickets/${req.params.id}/comment`, err);
  }
});

router.post('/itSupportTickets/:id/cancel', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itSupportTickets', itemId, (item) =>
      recordActions.cancelItTicket(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itSupportTickets/${req.params.id}/cancel`, err);
  }
});

// Leo thang phê duyệt (xem escalateItTicket() ở lib/recordActions.js) — cần usersList để xác thực
// approverUsername thực sự tồn tại/còn active, nên dùng getFreshUser(req).users (req.allUsers).
router.post('/itSupportTickets/:id/escalate', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itSupportTickets', itemId, (item) =>
      recordActions.escalateItTicket(freshUser, item, req.body, users));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itSupportTickets/${req.params.id}/escalate`, err);
  }
});

router.post('/itSupportTickets/:id/approve-escalation', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itSupportTickets', itemId, (item) =>
      recordActions.approveItTicketEscalation(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itSupportTickets/${req.params.id}/approve-escalation`, err);
  }
});

router.post('/itSupportTickets/:id/deny-escalation', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itSupportTickets', itemId, (item) =>
      recordActions.denyItTicketEscalation(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itSupportTickets/${req.params.id}/deny-escalation`, err);
  }
});

// ===================== NHÂN SỰ ("HCRC Đồng Hành" — hỏi & đáp) =====================
// Câu hỏi được TẠO qua engine chung (POST /api/create/hrFeedback, xem lib/createValidation.js) — ở đây
// chỉ còn 2 hành động sau khi đã tồn tại: Nhân Sự trả lời, và nhân viên đánh dấu đã đọc phản hồi.
router.post('/hrFeedback/:id/delete', (req, res) => deleteAdminOnly(req, res, 'hrFeedback'));

router.post('/hrFeedback/:id/respond', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('hrFeedback', itemId, (item) =>
      recordActions.respondToHrFeedback(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `hrFeedback/${req.params.id}/respond`, err);
  }
});

router.post('/hrFeedback/:id/mark-read', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('hrFeedback', itemId, (item) =>
      recordActions.markHrFeedbackRead(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `hrFeedback/${req.params.id}/mark-read`, err);
  }
});

// ===================== NHÂN SỰ > Onboarding / Offboarding (v2 — checklist theo giai đoạn) =====================
// Quy trình được TẠO qua engine chung (POST /api/create/hrProcesses, xem lib/createValidation.js) với
// tasks[] đã tự sinh sẵn — mọi thao tác VẬN HÀNH sau đó (hoàn thành/bỏ qua/giao lại task, huỷ quy
// trình, đính kèm file, tạo ticket IT cho 1 task) là các route dưới đây, đều khoá record qua
// withLockedRecordForCollection() rồi gọi đúng hàm tương ứng ở lib/recordActions.js.

// Hồ Sơ Nhân Sự (Phần C, đợt 1/4 module Nhân Sự) — computeHrProcessProgress() ở lib/recordActions.js tự
// chuyển item.status='COMPLETED' + push đúng 1 dòng history {action:'COMPLETED'} NGAY LÚC transition (từ
// bất kỳ đường nào dẫn tới đó: complete-task/skip-task/IT-ticket-hoàn-tất) — nên "dòng history cuối cùng
// là COMPLETED" là tín hiệu đáng tin để biết ĐÚNG LƯỢT GỌI NÀY vừa hoàn tất quy trình (không phải quy
// trình đã COMPLETED từ trước). Đây là 1 ghi có tác dụng phụ CHÉO COLLECTION (hrProcesses ->
// employeeProfiles, 2 khoá AppData/Records khác nhau, không atomic được với nhau) — cùng tinh thần
// learnLicenseType() ở routes/create.js: lỗi ở bước phụ này KHÔNG được phép làm hỏng thao tác chính đã
// commit xong, chỉ log lại để tra cứu sau.
async function syncEmployeeProfileOnHrCompletion(hrProcessItem, routeLabel) {
  const last = (hrProcessItem.history || [])[hrProcessItem.history.length - 1];
  if (!last || last.action !== 'COMPLETED') return;
  try {
    await withLockedAppDataValue('employeeProfiles', (list) => employeeProfile.applyProcessCompletion(list, hrProcessItem));
  } catch (err) {
    console.error(`${routeLabel}: lỗi cập nhật trạng thái Hồ Sơ Nhân Sự khi hoàn tất quy trình:`, err.message);
  }
}

// Hợp Đồng Lao Động (Đợt 2/4 module Nhân Sự — xem lib/laborContract.js đầu file cho toàn bộ luật vòng
// đời) — 3 mốc TRONG checklist ONBOARDING tự động tạo/kích hoạt/đóng hợp đồng, gọi NGAY SAU khi
// complete-task/skip-task đã khoá + ghi xong hrProcesses. Cùng tinh thần syncEmployeeProfileOnHrCompletion
// ở trên: đây là ghi có tác dụng phụ CHÉO COLLECTION (hrProcesses -> laborContracts, khác khoá, không
// atomic được với nhau) — lỗi ở bước phụ này KHÔNG được phép làm hỏng thao tác chính đã commit xong (task
// đã DONE/quyết định đã ghi), chỉ log lại để tra cứu sau. Validate body.decision hợp lệ đã xảy ra TRƯỚC,
// trong CÙNG khoá với việc đánh dấu task DONE (xem recordActions.completeHrTask()) — ở đây chỉ đọc lại
// task.decision đã được ghi, không validate lại.
async function syncLaborContractOnHrTaskEvent(hrProcessItem, taskId, actorUser, routeLabel) {
  if (hrProcessItem.processType !== 'ONBOARDING') return;
  const task = (hrProcessItem.tasks || []).find(t => t.taskId === Number(taskId));
  if (!task || task.status !== 'DONE' || ![1, 7, 15].includes(task.templateId)) return;
  try {
    if (task.templateId === 1) {
      const list = await getAllForCollection('laborContracts');
      const draft = laborContract.buildProbationDraftPayload(hrProcessItem, list);
      if (draft) await createForCollection('laborContracts', () => draft);
    } else if (task.templateId === 7) {
      const list = await getAllForCollection('laborContracts');
      const contract = laborContract.findLatestContractForProcess(list, hrProcessItem.id);
      if (contract) {
        await withLockedRecordForCollection('laborContracts', contract.id, (item) => laborContract.applyActivateProbation(item, hrProcessItem));
      }
    } else if (task.templateId === 15 && task.decision) {
      const list = await getAllForCollection('laborContracts');
      const contract = laborContract.findLatestContractForProcess(list, hrProcessItem.id);
      if (!contract) return;
      let nextPayload = null;
      await withLockedRecordForCollection('laborContracts', contract.id, (item) => {
        const result = laborContract.applyPostProbationDecision(item, task.decision, list, actorUser?.username);
        nextPayload = result.nextContractPayload;
        return result.closedContract;
      });
      if (nextPayload) await createForCollection('laborContracts', () => nextPayload);
    }
  } catch (err) {
    console.error(`${routeLabel}: lỗi đồng bộ Hợp Đồng Lao Động:`, err.message);
  }
}

// OFFBOARDING hoàn tất (COMPLETED, cùng tín hiệu "dòng history cuối là COMPLETED" như
// syncEmployeeProfileOnHrCompletion) -> đóng hợp đồng đang ACTIVE của nhân viên này (nếu có). Tra theo
// employeeProfiles để đổi employeeUsername (duy nhất OFFBOARDING có) sang employeeCode (khoá thật của
// laborContracts) — tái dùng employeeProfile.findProfileByUsername() đã xây ở Đợt 1.
async function syncLaborContractOnHrProcessCompletion(hrProcessItem, routeLabel) {
  if (hrProcessItem.processType !== 'OFFBOARDING') return;
  const last = (hrProcessItem.history || [])[hrProcessItem.history.length - 1];
  if (!last || last.action !== 'COMPLETED') return;
  try {
    const profileList = (await getAppDataValue('employeeProfiles')) || [];
    const profile = employeeProfile.findProfileByUsername(profileList, hrProcessItem.employeeUsername);
    if (!profile) return;
    const list = await getAllForCollection('laborContracts');
    const contract = laborContract.findActiveContractByEmployeeCode(list, profile.employeeCode);
    if (!contract) return;
    await withLockedRecordForCollection('laborContracts', contract.id, (item) => laborContract.applyOffboardingTermination(item, hrProcessItem));
  } catch (err) {
    console.error(`${routeLabel}: lỗi cập nhật Hợp Đồng Lao Động khi Offboarding hoàn tất:`, err.message);
  }
}

// Công & Phép (Đợt 3/4 module Nhân Sự — xem lib/attendance.js đầu file cho toàn bộ các điều chỉnh so
// với tài liệu gốc). ONBOARDING Stage=COMPLETED -> tạo LeaveBalance năm hiện tại (pro-rated theo
// startDate) cho employeeCode này — idempotent (ensureLeaveBalanceForYear không tạo trùng).
async function syncLeaveBalanceOnOnboardingCompletion(hrProcessItem, routeLabel) {
  if (hrProcessItem.processType !== 'ONBOARDING') return;
  const last = (hrProcessItem.history || [])[hrProcessItem.history.length - 1];
  if (!last || last.action !== 'COMPLETED') return;
  try {
    const year = new Date().getFullYear();
    await withLockedAppDataValue('leaveBalances', (list) => {
      const { list: updated } = attendance.ensureLeaveBalanceForYear(list, hrProcessItem.employeeCode, hrProcessItem.startDate, year);
      return updated;
    });
  } catch (err) {
    console.error(`${routeLabel}: lỗi tạo Phép Năm khi Onboarding hoàn tất:`, err.message);
  }
}

// Task SETTLEMENT "Tính lương, phép năm chưa nghỉ..." (templateId=25, defaults.js hrTaskTemplates)
// hoàn thành -> TÍNH VÀ GHI LẠI số tiền quy đổi phép chưa nghỉ tham khảo (KHÔNG tạo đề nghị thanh toán
// thật — hệ thống chưa có module Lương, xem ghi chú mục 5 đầu lib/attendance.js) lên chính task đó để
// HR đọc.
async function syncLeavePayoutInfoOnSettlementTask(hrProcessItem, taskId, routeLabel) {
  if (hrProcessItem.processType !== 'OFFBOARDING') return;
  const task = (hrProcessItem.tasks || []).find(t => t.taskId === Number(taskId));
  if (!task || task.status !== 'DONE' || task.templateId !== 25) return;
  try {
    const profileList = (await getAppDataValue('employeeProfiles')) || [];
    const profile = employeeProfile.findProfileByUsername(profileList, hrProcessItem.employeeUsername);
    if (!profile) return;
    const contractList = await getAllForCollection('laborContracts');
    const activeContract = laborContract.findActiveContractByEmployeeCode(contractList, profile.employeeCode);
    const usersList = (await getAppDataValue('users')) || [];
    const hrProcessesList = await getAllForCollection('hrProcesses');
    const info = attendance.resolveWorkModelForEmployeeCode(profile.employeeCode, { employeeProfiles: profileList, users: usersList, hrProcesses: hrProcessesList });
    const year = new Date(hrProcessItem.lastWorkingDate || Date.now()).getFullYear();
    const balanceList = await getAllForCollection('leaveBalances');
    const balance = balanceList.find(b => b.employeeCode === profile.employeeCode && b.year === year);
    const remainingDays = balance ? Math.max(0, balance.totalDays - balance.usedDays) : 0;
    const payout = attendance.computeLeavePayoutInfo(activeContract?.baseSalary, remainingDays, info?.workModel);
    await withLockedRecordForCollection('hrProcesses', hrProcessItem.id, (item) => {
      const t = (item.tasks || []).find(x => x.taskId === Number(taskId));
      if (t) t.leavePayoutInfo = payout;
      return item;
    });
  } catch (err) {
    console.error(`${routeLabel}: lỗi tính tiền phép năm chưa nghỉ khi Offboarding:`, err.message);
  }
}

// OFFBOARDING hoàn tất -> huỷ mọi đơn nghỉ phép PENDING + mọi dòng phân ca (ShiftRoster) SAU
// lastWorkingDate của nhân viên này (Phần F tài liệu thiết kế: khoá đơn nghỉ mới, cảnh báo Quản Lý Siêu
// Thị roster tương lai bị huỷ — ở đây chỉ tự huỷ dữ liệu, cảnh báo hiển thị phía client khi Quản Lý Siêu
// Thị mở màn Lịch Phân Ca thấy dòng bị huỷ ghi rõ lý do).
async function syncOffboardingToAttendanceAndLeave(hrProcessItem, routeLabel) {
  if (hrProcessItem.processType !== 'OFFBOARDING') return;
  const last = (hrProcessItem.history || [])[hrProcessItem.history.length - 1];
  if (!last || last.action !== 'COMPLETED') return;
  try {
    const profileList = (await getAppDataValue('employeeProfiles')) || [];
    const profile = employeeProfile.findProfileByUsername(profileList, hrProcessItem.employeeUsername);
    if (!profile) return;
    const leaveList = await getAllForCollection('leaveRequests');
    const updatedLeave = attendance.cancelPendingLeaveRequestsAfterOffboarding(leaveList, profile.employeeCode);
    for (const r of updatedLeave) {
      const before = leaveList.find(x => x.id === r.id);
      if (before && before.status !== r.status) {
        await withLockedRecordForCollection('leaveRequests', r.id, () => r);
      }
    }
    const rosterList = await getAllForCollection('shiftRoster');
    const updatedRoster = attendance.cancelFutureRosterAfterOffboarding(rosterList, profile.employeeCode, hrProcessItem.lastWorkingDate || new Date().toISOString().slice(0, 10));
    for (const r of updatedRoster) {
      const before = rosterList.find(x => x.id === r.id);
      if (before && before.status !== r.status) {
        await withLockedRecordForCollection('shiftRoster', r.id, () => r);
      }
    }
  } catch (err) {
    console.error(`${routeLabel}: lỗi huỷ đơn nghỉ phép/lịch phân ca khi Offboarding hoàn tất:`, err.message);
  }
}

// Đợt 4 (vá Phần B, mục A.6 tài liệu thiết kế) — vừa chỉ định người kế nhiệm xong (assignHrSuccessor())
// -> chuyển NGAY managerUsername của mọi báo cáo trực tiếp hiện tại (managerUsername === employeeUsername
// đang nghỉ việc) sang người kế nhiệm. 2 bước khoá riêng (hrProcesses rồi users) — cùng khuôn
// lib/orgChart.js applyVersionInPlace()/computeManagerUsernameUpdates() ở routes/orgChart.js. KHÔNG tự
// đổi dept/jobTitle người kế nhiệm — đó là quyết định đề bạt riêng của HR (Sửa Người Dùng + "Đồng Bộ
// Quản Lý Trực Tiếp" ở Cơ Cấu Tổ Chức nếu người kế nhiệm cũng cần thay vị trí trong cây tổ chức).
async function syncManagerUsernameOnSuccessorAssigned(hrProcessItem, routeLabel) {
  if (!hrProcessItem || hrProcessItem.processType !== 'OFFBOARDING' || !hrProcessItem.successorUsername) return;
  try {
    await withLockedAppDataValue('users', (list) => {
      let changed = false;
      const updated = (list || []).map(u => {
        if (u.active !== false && u.managerUsername === hrProcessItem.employeeUsername) {
          changed = true;
          return { ...u, managerUsername: hrProcessItem.successorUsername };
        }
        return u;
      });
      return changed ? updated : list;
    });
  } catch (err) {
    console.error(`${routeLabel}: lỗi chuyển giao Quản Lý Trực Tiếp sang người kế nhiệm:`, err.message);
  }
}

router.post('/hrProcesses/:id/assign-successor', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('hrProcesses', itemId, (item) =>
      recordActions.assignHrSuccessor(freshUser, item, req.body, users));
    await syncManagerUsernameOnSuccessorAssigned(result, `hrProcesses/${itemId}/assign-successor`);
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `hrProcesses/${req.params.id}/assign-successor`, err);
  }
});

router.post('/hrProcesses/:id/delete', (req, res) => deleteAdminOnly(req, res, 'hrProcesses'));

router.post('/hrProcesses/:id/complete-task', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('hrProcesses', itemId, (item) =>
      recordActions.completeHrTask(freshUser, item, req.body, users));
    await syncEmployeeProfileOnHrCompletion(result, `hrProcesses/${itemId}/complete-task`);
    await syncLaborContractOnHrTaskEvent(result, req.body?.taskId, freshUser, `hrProcesses/${itemId}/complete-task`);
    await syncLaborContractOnHrProcessCompletion(result, `hrProcesses/${itemId}/complete-task`);
    await syncLeaveBalanceOnOnboardingCompletion(result, `hrProcesses/${itemId}/complete-task`);
    await syncLeavePayoutInfoOnSettlementTask(result, req.body?.taskId, `hrProcesses/${itemId}/complete-task`);
    await syncOffboardingToAttendanceAndLeave(result, `hrProcesses/${itemId}/complete-task`);
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `hrProcesses/${req.params.id}/complete-task`, err);
  }
});

router.post('/hrProcesses/:id/skip-task', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('hrProcesses', itemId, (item) =>
      recordActions.skipHrTask(freshUser, item, req.body, users));
    await syncEmployeeProfileOnHrCompletion(result, `hrProcesses/${itemId}/skip-task`);
    await syncLaborContractOnHrProcessCompletion(result, `hrProcesses/${itemId}/skip-task`);
    await syncOffboardingToAttendanceAndLeave(result, `hrProcesses/${itemId}/skip-task`);
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `hrProcesses/${req.params.id}/skip-task`, err);
  }
});

// reassignHrTask() cần usersList để xác thực assignedToUsername thực sự tồn tại/còn active — cùng khuôn
// escalateItTicket() ở trên.
router.post('/hrProcesses/:id/reassign-task', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('hrProcesses', itemId, (item) =>
      recordActions.reassignHrTask(freshUser, item, req.body, users));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `hrProcesses/${req.params.id}/reassign-task`, err);
  }
});

router.post('/hrProcesses/:id/cancel', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('hrProcesses', itemId, (item) =>
      recordActions.cancelHrProcess(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `hrProcesses/${req.params.id}/cancel`, err);
  }
});

router.post('/hrProcesses/:id/attachments', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('hrProcesses', itemId, (item) =>
      recordActions.addHrProcessAttachment(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `hrProcesses/${req.params.id}/attachments`, err);
  }
});

// Tạo ticket Hỗ Trợ IT cho 1 task nhãn IT — cùng khuôn "khoá A -> build bản nháp B -> insert B" như
// /contracts/:id/start-payment ở đầu file: id của B (ticketId) phải tự sinh TRƯỚC (Date.now()) rồi
// truyền vào cả 2 bước, vì A cần ghi lại task.linkedTicketId=ticketId NGAY TRONG lúc khoá A.
router.post('/hrProcesses/:id/create-it-ticket', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const ticketId = Date.now();
    let draft = null;
    const result = await withLockedRecordForCollection('hrProcesses', itemId, (item) => {
      draft = recordActions.createItTicketForHrTask(freshUser, item, req.body, ticketId);
      return item;
    });
    const ticket = await createForCollection('itSupportTickets', () => ({ ...draft, id: ticketId }));
    res.json({ ok: true, item: result, ticket });
  } catch (err) {
    handleError(res, `hrProcesses/${req.params.id}/create-it-ticket`, err);
  }
});

// ===================== ĐỒNG PHỤC =====================
router.post('/uniformPeriods/:id/delete', (req, res) => deleteAdminOnly(req, res, 'uniformPeriods'));

// Duyệt/Từ chối cả kỳ (Phase 2, uniformApprove/admin) — PHẢI chạy TRƯỚC khi Giám Đốc Siêu Thị xác nhận
// được bất kỳ phần phân bổ nào (xem canApproveUniform()/approveUniformPeriod()/rejectUniformPeriod() ở
// lib/recordActions.js). Khoá theo bản ghi kỳ, cùng khuôn confirm-allocation bên dưới.
router.post('/uniformPeriods/:id/approve', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('uniformPeriods', itemId, (item) =>
      recordActions.approveUniformPeriod(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `uniformPeriods/${req.params.id}/approve`, err);
  }
});

router.post('/uniformPeriods/:id/reject', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('uniformPeriods', itemId, (item) =>
      recordActions.rejectUniformPeriod(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `uniformPeriods/${req.params.id}/reject`, err);
  }
});

// Giám Đốc Siêu Thị xác nhận đã nhận ĐÚNG phần phân bổ của phòng ban mình trong 1 kỳ — khoá theo bản
// ghi kỳ (nhiều siêu thị khác nhau xác nhận gần như đồng thời trên CÙNG 1 kỳ chỉ xếp hàng chờ khoá).
router.post('/uniformPeriods/:id/confirm-allocation', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('uniformPeriods', itemId, (item) =>
      recordActions.confirmUniformAllocation(freshUser, item, req.body));
    // Sinh/tái sử dụng SKU (Phase 2) cho ĐÚNG phần vừa xác nhận — collection RIÊNG (uniformCatalog, còn
    // ở AppData, không phải dbo.Records) nên khoá+lưu TÁCH RIÊNG khỏi bước khoá bản ghi kỳ ở trên (2
    // khoá độc lập, gọi TUẦN TỰ chứ không lồng nhau — không có nguy cơ deadlock). Cố tình KHÔNG để lỗi ở
    // đây chặn việc xác nhận đã ghi thành công — sinh SKU là best-effort, thất bại thì lần xác nhận sau
    // (ở siêu thị khác/kỳ khác) sẽ tự backfill lại. Trả kèm catalog MỚI trong response (không chỉ ghi
    // xuống DB) để client cập nhật NGAY DB.uniformCatalog phía trình duyệt — không có bước này, giao
    // diện sẽ không hiện được mã SKU vừa sinh cho tới khi tải lại trang (client không tự động refetch
    // GET /api/data sau mỗi hành động, xem confirmUniformAllocationAction() ở public/index.html).
    let updatedCatalog = null;
    try {
      const allocId = Number(req.body?.allocationId);
      const alloc = (result.allocations || []).find(a => a.id === allocId);
      if (alloc) {
        updatedCatalog = await withLockedAppDataValue('uniformCatalog', (catalog) => {
          const list = Array.isArray(catalog) ? catalog : [];
          recordActions.backfillUniformSkuCodes(alloc.items, list);
          return list;
        });
      }
    } catch (skuErr) {
      console.error(`Lỗi sinh SKU đồng phục sau khi xác nhận kỳ ${itemId} (không chặn xác nhận):`, skuErr.message);
    }
    const responseBody = { ok: true, item: result };
    if (updatedCatalog) responseBody.uniformCatalog = updatedCatalog;
    res.json(responseBody);
  } catch (err) {
    handleError(res, `uniformPeriods/${req.params.id}/confirm-allocation`, err);
  }
});

router.post('/uniformIssuances/:id/delete', (req, res) => deleteAdminOnly(req, res, 'uniformIssuances'));

// Giám Đốc Siêu Thị cấp phát đồng phục cho nhân viên — tạo mới (không qua /api/create/ chung vì cần
// đọc chéo uniformPeriods + tính lại tồn kho + khoá theo TỪNG siêu thị, xem buildUniformIssuance() ở
// lib/recordActions.js). withAppLock('uniform_store:<dept>', ...) bọc quanh TOÀN BỘ đọc-tính-ghi để 2
// lượt cấp phát gần như đồng thời cùng 1 siêu thị không cùng đọc thấy tồn kho cũ rồi cùng vượt tồn.
router.post('/uniformIssuances/create', async (req, res) => {
  try {
    const { freshUser, users } = await getFreshUser(req);
    if (!recordActions.canManageUniformStore(freshUser)) {
      return res.status(403).json({ error: 'Bạn không có quyền cấp phát đồng phục' });
    }
    const result = await withAppLock(`uniform_store:${freshUser.dept}`, async () => {
      // uniformStockAdjustments PHẢI đọc cùng lượt (giống uniformStockAdjustments/create bên dưới):
      // tồn kho lúc cấp phát trừ cả hàng hỏng/hủy/mất và cộng lại phần đã thu hồi từ nhân viên.
      const [allPeriods, allIssuances, allAdjustments, allTransfers] = await Promise.all([
        getAllForCollection('uniformPeriods'),
        getAllForCollection('uniformIssuances'),
        getAllForCollection('uniformStockAdjustments'),
        getAllForCollection('uniformTransfers')
      ]);
      const storeIssuances = allIssuances.filter(x => x.dept === freshUser.dept);
      const storeAdjustments = allAdjustments.filter(x => x.dept === freshUser.dept);
      const approvedTransfers = allTransfers.filter(t => t.status === 'APPROVED' || t.status === 'RECEIVED');
      const record = recordActions.buildUniformIssuance(freshUser, req.body, allPeriods, storeIssuances, storeAdjustments, users, approvedTransfers);
      return insertRecord('uniformIssuances', record);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, 'uniformIssuances/create', err);
  }
});

// Nhân viên tự xác nhận đã nhận đúng phiếu cấp phát CỦA MÌNH — khoá theo bản ghi phiếu (mirror
// uniformPeriods/:id/approve ở trên). Quyền xác thực lại hoàn toàn ở server (acknowledgeUniformIssuance()),
// không tin cờ hiện/ẩn nút ở client.
router.post('/uniformIssuances/:id/acknowledge', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('uniformIssuances', itemId, (item) =>
      recordActions.acknowledgeUniformIssuance(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `uniformIssuances/${req.params.id}/acknowledge`, err);
  }
});

router.post('/uniformStockAdjustments/:id/delete', (req, res) => deleteAdminOnly(req, res, 'uniformStockAdjustments'));

// Giám Đốc Siêu Thị báo Hỏng/Hủy từ tồn kho hoặc thu hồi từ nhân viên — cùng khoá 'uniform_store:<dept>'
// với uniformIssuances/create vì cả 2 route cùng đọc-tính-ghi trên chung trạng thái tồn kho/số đang giữ
// của TỪNG siêu thị (không được để 2 thao tác chạy song song đọc cùng 1 số liệu cũ).
router.post('/uniformStockAdjustments/create', async (req, res) => {
  try {
    const { freshUser, users } = await getFreshUser(req);
    if (!recordActions.canManageUniformStore(freshUser)) {
      return res.status(403).json({ error: 'Bạn không có quyền thao tác này' });
    }
    const result = await withAppLock(`uniform_store:${freshUser.dept}`, async () => {
      const [allPeriods, allIssuances, allAdjustments, allTransfers] = await Promise.all([
        getAllForCollection('uniformPeriods'),
        getAllForCollection('uniformIssuances'),
        getAllForCollection('uniformStockAdjustments'),
        getAllForCollection('uniformTransfers')
      ]);
      const storeIssuances = allIssuances.filter(x => x.dept === freshUser.dept);
      const storeAdjustments = allAdjustments.filter(x => x.dept === freshUser.dept);
      const approvedTransfers = allTransfers.filter(t => t.status === 'APPROVED' || t.status === 'RECEIVED');
      const record = recordActions.buildUniformStockAdjustment(freshUser, req.body, allPeriods, storeIssuances, storeAdjustments, users, approvedTransfers);
      return insertRecord('uniformStockAdjustments', record);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, 'uniformStockAdjustments/create', err);
  }
});

router.post('/uniformTransfers/:id/delete', (req, res) => deleteAdminOnly(req, res, 'uniformTransfers'));

// Giám Đốc Siêu Thị NGUỒN yêu cầu điều chuyển (Phase 2) — cùng khoá 'uniform_store:<dept nguồn>' với 3
// route trên (đụng chung trạng thái tồn kho của ĐÚNG siêu thị nguồn lúc kiểm tra đủ hàng để chuyển).
router.post('/uniformTransfers/create', async (req, res) => {
  try {
    const { freshUser } = await getFreshUser(req);
    if (!recordActions.canManageUniformStore(freshUser)) {
      return res.status(403).json({ error: 'Bạn không có quyền yêu cầu điều chuyển kho' });
    }
    const result = await withAppLock(`uniform_store:${freshUser.dept}`, async () => {
      const [allPeriods, allIssuances, allAdjustments, allTransfers] = await Promise.all([
        getAllForCollection('uniformPeriods'),
        getAllForCollection('uniformIssuances'),
        getAllForCollection('uniformStockAdjustments'),
        getAllForCollection('uniformTransfers')
      ]);
      const storeIssuances = allIssuances.filter(x => x.dept === freshUser.dept);
      const storeAdjustments = allAdjustments.filter(x => x.dept === freshUser.dept);
      const approvedTransfers = allTransfers.filter(t => t.status === 'APPROVED' || t.status === 'RECEIVED');
      const record = recordActions.buildUniformTransfer(freshUser, req.body, allPeriods, storeIssuances, storeAdjustments, approvedTransfers);
      return insertRecord('uniformTransfers', record);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, 'uniformTransfers/create', err);
  }
});

router.post('/uniformTransfers/:id/reject', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('uniformTransfers', itemId, (item) =>
      recordActions.rejectUniformTransfer(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `uniformTransfers/${req.params.id}/reject`, err);
  }
});

// Duyệt điều chuyển (Phase 2, uniformApprove/admin) — ĐỤNG ĐỒNG THỜI 2 siêu thị (nguồn giảm/đích tăng
// tồn kho tính động cùng lúc, xem computeUniformStock() tham số allApprovedTransfers), nên PHẢI khoá CẢ
// 2 khoá 'uniform_store:<nguồn>' + 'uniform_store:<đích>' trong SUỐT lúc đọc-kiểm tra-duyệt — không chỉ
// khoá đúng 1 dòng uniformTransfers như withLockedRecordForCollection() thường làm (không đủ: 1 request
// khác đang cấp phát/báo hỏng/điều chuyển CHO ĐÚNG 1 trong 2 siêu thị này vẫn có thể đọc-ghi tồn kho
// song song, dẫn tới đọc thấy tồn "cũ" nếu không cùng khoá 'uniform_store:<dept>'). withAppLock() ở
// lib/recordStore.js nhận MẢNG khoá, tự sắp XẾP THEO BẢNG CHỮ CÁI trước khi giành lần lượt — 2 điều
// chuyển ngược chiều nhau giữa CÙNG 2 siêu thị (A->B và B->A) luôn giành khoá theo ĐÚNG 1 THỨ TỰ như
// nhau nên không bao giờ deadlock chờ chéo. Đọc bản ghi 1 lần TRƯỚC để biết chính xác 2 dept liên quan
// (chỉ để LẤY TÊN KHOÁ — mọi kiểm tra nghiệp vụ thật chạy LẠI bên trong, dưới khoá, vì bản ghi có thể đã
// bị xử lý bởi 1 request khác giữa 2 lần đọc).
router.post('/uniformTransfers/:id/approve', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    if (!recordActions.canApproveUniformTransfer(freshUser)) {
      return res.status(403).json({ error: 'Bạn không có quyền duyệt điều chuyển kho' });
    }
    const peekAll = await getAllForCollection('uniformTransfers');
    const peek = peekAll.find(t => t.id === itemId);
    if (!peek) return res.status(404).json({ error: 'Không tìm thấy yêu cầu điều chuyển này' });

    const result = await withAppLock([`uniform_store:${peek.sourceDept}`, `uniform_store:${peek.targetDept}`], () =>
      withLockedRecordById('uniformTransfers', itemId, async (transfer) => {
        if (transfer.status !== 'PENDING_APPROVAL') {
          throw new HttpError(409, 'Yêu cầu điều chuyển này đã được xử lý trước đó');
        }
        const [allPeriods, allIssuances, allAdjustments, allTransfers] = await Promise.all([
          getAllForCollection('uniformPeriods'),
          getAllForCollection('uniformIssuances'),
          getAllForCollection('uniformStockAdjustments'),
          getAllForCollection('uniformTransfers')
        ]);
        const sourceIssuances = allIssuances.filter(x => x.dept === transfer.sourceDept);
        const sourceAdjustments = allAdjustments.filter(x => x.dept === transfer.sourceDept);
        const approvedTransfers = allTransfers.filter(t => (t.status === 'APPROVED' || t.status === 'RECEIVED') && t.id !== transfer.id);
        const sourceStock = recordActions.computeUniformStock(allPeriods, transfer.sourceDept, sourceIssuances, sourceAdjustments, approvedTransfers);
        return recordActions.approveUniformTransfer(freshUser, transfer, sourceStock);
      })
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `uniformTransfers/${req.params.id}/approve`, err);
  }
});

// Giám Đốc Siêu Thị ĐÍCH xác nhận đã nhận hàng (mô hình "hàng đang vận chuyển" — xem
// receiveUniformTransfer() ở lib/recordActions.js) — CHỈ đụng kho ĐÍCH (kho nguồn đã trừ xong lúc
// duyệt), nên chỉ cần khoá riêng 'uniform_store:<targetDept>', không cần khoá kép như /approve.
router.post('/uniformTransfers/:id/receive', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const peekAll = await getAllForCollection('uniformTransfers');
    const peek = peekAll.find(t => t.id === itemId);
    if (!peek) return res.status(404).json({ error: 'Không tìm thấy yêu cầu điều chuyển này' });
    if (!recordActions.canConfirmUniformTransferReceipt(freshUser, peek)) {
      return res.status(403).json({ error: 'Bạn không có quyền xác nhận nhận hàng điều chuyển này (chỉ Giám Đốc Siêu Thị ĐÍCH mới xác nhận được)' });
    }
    const result = await withAppLock(`uniform_store:${peek.targetDept}`, () =>
      withLockedRecordById('uniformTransfers', itemId, (transfer) =>
        recordActions.receiveUniformTransfer(freshUser, transfer))
    );
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `uniformTransfers/${req.params.id}/receive`, err);
  }
});

// ===================== GIẤY PHÉP (module con của Hành Chính) =====================
router.post('/licenses/:id/delete', (req, res) => deleteAdminOnly(req, res, 'licenses'));

router.post('/licenses/:id/approve', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('licenses', itemId, (item) =>
      recordActions.approveLicense(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `licenses/${req.params.id}/approve`, err);
  }
});

router.post('/licenses/:id/reject', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('licenses', itemId, (item) =>
      recordActions.rejectLicense(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `licenses/${req.params.id}/reject`, err);
  }
});

router.post('/licenses/:id/set-renewing', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('licenses', itemId, (item) =>
      recordActions.setLicenseRenewing(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `licenses/${req.params.id}/set-renewing`, err);
  }
});

router.post('/licenses/:id/revoke', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('licenses', itemId, (item) =>
      recordActions.revokeLicense(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `licenses/${req.params.id}/revoke`, err);
  }
});

router.post('/licenses/:id/unrevoke', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('licenses', itemId, (item) =>
      recordActions.unrevokeLicense(freshUser, item));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `licenses/${req.params.id}/unrevoke`, err);
  }
});

// ===================== GIA HẠN DỊCH VỤ CNTT (module con của Hỗ Trợ IT — itManage) =====================
router.post('/itServiceRenewals/:id/delete', (req, res) => deleteAdminOnly(req, res, 'itServiceRenewals'));

router.post('/itServiceRenewals/:id/edit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itServiceRenewals', itemId, (item) =>
      recordActions.editItServiceRenewal(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itServiceRenewals/${req.params.id}/edit`, err);
  }
});

router.post('/itServiceRenewals/:id/renew', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('itServiceRenewals', itemId, (item) =>
      recordActions.renewItServiceRenewal(freshUser, item, req.body));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `itServiceRenewals/${req.params.id}/renew`, err);
  }
});

// ===================== NHÂN SỰ > Hợp Đồng Lao Động (thao tác tay của HR) =====================
// Đa số bản ghi được HỆ THỐNG tự tạo/đóng qua sync*() ở trên — các route dưới đây phục vụ HR thao tác
// TAY: sửa field (điền lương/ngày hết hạn cho bản nháp tự tạo sau quyết định "Ký chính thức"), kích
// hoạt, bổ sung phụ lục/thay đổi, đóng tay, xoá (admin-only, cùng khuôn deleteAdminOnly() ở trên).
function assertContractManage(freshUser) {
  if (!laborContract.canManageContracts(freshUser)) throw new HttpError(403, 'Bạn không có quyền quản lý Hợp Đồng Lao Động');
}

router.post('/laborContracts/:id/edit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    assertContractManage(freshUser);
    const result = await withLockedRecordForCollection('laborContracts', itemId, (item) => {
      laborContract.applyManualEdit(item, req.body, freshUser.username);
      return item;
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `laborContracts/${req.params.id}/edit`, err);
  }
});

router.post('/laborContracts/:id/activate', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    assertContractManage(freshUser);
    const result = await withLockedRecordForCollection('laborContracts', itemId, (item) =>
      laborContract.applyActivateManual(item, freshUser.username));
    // Đóng hợp đồng ACTIVE KHÁC (nếu có, VD hợp đồng tạo tay hoàn toàn ngoài luồng Onboarding) của CÙNG
    // nhân viên thành SUPERSEDED — đảm bảo bất biến "chỉ 1 hợp đồng ACTIVE/nhân viên" cho cron cảnh báo
    // hết hạn (jobs/laborContractExpiryReminder.js) không bị nhầm lẫn nhiều hợp đồng active cùng lúc.
    const allContracts = await getAllForCollection('laborContracts');
    const otherActive = allContracts.find(c => c.id !== itemId && c.employeeCode === result.employeeCode && c.status === 'ACTIVE');
    if (otherActive) {
      await withLockedRecordForCollection('laborContracts', otherActive.id, (item) => {
        item.status = 'SUPERSEDED';
        item.history.push({ action: 'SUPERSEDED', by: freshUser.username, byName: freshUser.name, time: new Date().toLocaleString('vi-VN'), detail: `Tự đóng do hợp đồng ${result.code} được kích hoạt` });
        item.updatedAt = new Date().toLocaleString('vi-VN'); item.updatedBy = freshUser.username;
        return item;
      });
    }
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `laborContracts/${req.params.id}/activate`, err);
  }
});

router.post('/laborContracts/:id/add-amendment', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    assertContractManage(freshUser);
    let amendment = null;
    const result = await withLockedRecordForCollection('laborContracts', itemId, (item) => {
      amendment = laborContract.addAmendment(item, req.body, freshUser.username, freshUser.name);
      return item;
    });
    res.json({ ok: true, item: result, amendment });
  } catch (err) {
    handleError(res, `laborContracts/${req.params.id}/add-amendment`, err);
  }
});

router.post('/laborContracts/:id/status', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    assertContractManage(freshUser);
    const result = await withLockedRecordForCollection('laborContracts', itemId, (item) => {
      laborContract.assertValidManualStatusTransition(item.status, req.body?.status);
      item.status = req.body.status;
      if (req.body.status === 'TERMINATED') {
        item.terminationDate = req.body.terminationDate || new Date().toISOString().slice(0, 10);
        item.terminationReason = req.body.terminationReason ? String(req.body.terminationReason).trim().slice(0, 300) : null;
      }
      item.history.push({ action: req.body.status, by: freshUser.username, byName: freshUser.name, time: new Date().toLocaleString('vi-VN'), detail: `Chuyển tay sang trạng thái ${req.body.status}` });
      item.updatedAt = new Date().toLocaleString('vi-VN'); item.updatedBy = freshUser.username;
      return item;
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `laborContracts/${req.params.id}/status`, err);
  }
});

router.post('/laborContracts/:id/delete', (req, res) => deleteAdminOnly(req, res, 'laborContracts'));

// ===================== NHÂN SỰ > Công & Phép (Đợt 3/4 — xem lib/attendance.js) =====================

// leaveRequests: nhân viên tự huỷ đơn PENDING/APPROVED-chưa-tới-ngày của CHÍNH MÌNH.
router.post('/leaveRequests/:id/cancel', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const profileList = (await getAppDataValue('employeeProfiles')) || [];
    const profile = employeeProfile.findProfileByUsername(profileList, freshUser.username);
    const result = await withLockedRecordForCollection('leaveRequests', itemId, (item) => {
      if (!profile || item.employeeCode !== profile.employeeCode) throw new HttpError(403, 'Bạn chỉ được huỷ đơn nghỉ phép của chính mình');
      return attendance.applyCancelLeaveRequest(item, freshUser.username);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `leaveRequests/${req.params.id}/cancel`, err);
  }
});

function assertLeaveApprover(freshUser, employeeUsername, allUsers) {
  if (!attendance.canApproveLeaveRequest(freshUser, allUsers, employeeUsername)) {
    throw new HttpError(403, 'Bạn không có quyền duyệt đơn nghỉ phép này');
  }
}

router.post('/leaveRequests/:id/approve', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const profileList = (await getAppDataValue('employeeProfiles')) || [];
    let affectedRosterIds = [];
    const result = await withLockedRecordForCollection('leaveRequests', itemId, (item) => {
      const empUsername = employeeProfile.findProfile(profileList, item.employeeCode)?.username;
      assertLeaveApprover(freshUser, empUsername, users);
      const rosterListForCheck = []; // affectedRosterIds tính lại đầy đủ ngay dưới bằng dữ liệu thật
      const { updated } = attendance.applyApproveLeaveRequest(item, freshUser.username, freshUser.name, rosterListForCheck);
      return updated;
    });
    if (result.workModel === 'SHIFT_BASED') {
      const rosterList = await getAllForCollection('shiftRoster');
      affectedRosterIds = rosterList.filter(r => r.employeeCode === result.employeeCode && r.status !== 'CANCELLED'
        && r.workDate >= result.fromDate && r.workDate <= result.toDate).map(r => r.id);
      if (affectedRosterIds.length) {
        await withLockedRecordForCollection('leaveRequests', itemId, (item) => { item.affectedRosterIds = affectedRosterIds; return item; });
        result.affectedRosterIds = affectedRosterIds;
      }
    }
    // Trừ LeaveBalance (chỉ ANNUAL) + ghi AttendanceRecords LEAVE_PAID/LEAVE_UNPAID/SICK_LEAVE cho từng
    // ngày trong khoảng nghỉ — xem lib/attendance.js buildLeaveAttendanceRecords()/deductLeaveBalance().
    // BUG THẬT vừa sửa: leaveBalances là collection dbo.Records (MIGRATED_COLLECTIONS, xem
    // lib/recordStore.js), KHÔNG PHẢI dbo.AppData — dòng cũ gọi withLockedAppDataValue('leaveBalances', ...)
    // đọc/ghi nhầm bảng dbo.AppData (key "leaveBalances" không hề tồn tại ở đó), khiến MỌI lượt duyệt đơn
    // phép năm ANNUAL ném lỗi "Key không tồn tại trong AppData" ngay tại đây — phép năm KHÔNG BAO GIỜ
    // được trừ dù response vẫn báo lỗi 500 sau khi đơn đã chuyển APPROVED (do dòng cập nhật item.status
    // ở withLockedRecordForCollection('leaveRequests', ...) phía trên ĐÃ commit xong trước khi chạy tới
    // đây) — phát hiện khi viết test hồi quy (tests/test-attendance-leave.js). Sửa đúng bằng
    // withLockedRecordForCollection('leaveBalances', id, ...), cùng khuôn leaveBalances/:id/adjust ở dưới.
    if (result.leaveType === 'ANNUAL') {
      const year = new Date(result.fromDate).getFullYear();
      const balanceList = await getAllForCollection('leaveBalances');
      const balance = balanceList.find(b => b.employeeCode === result.employeeCode && b.year === year);
      if (balance) {
        await withLockedRecordForCollection('leaveBalances', balance.id, (item) => attendance.deductLeaveBalance(item, result.daysCount));
      }
    }
    const attendanceList = await getAllForCollection('attendanceRecords');
    const toApply = attendance.buildLeaveAttendanceRecords(result, attendanceList);
    for (const { record, isNew } of toApply) {
      if (isNew) await createForCollection('attendanceRecords', () => record);
      else await withLockedRecordForCollection('attendanceRecords', record.id, () => record);
    }
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `leaveRequests/${req.params.id}/approve`, err);
  }
});

router.post('/leaveRequests/:id/reject', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser, users } = await getFreshUser(req);
    const profileList = (await getAppDataValue('employeeProfiles')) || [];
    const result = await withLockedRecordForCollection('leaveRequests', itemId, (item) => {
      const empUsername = employeeProfile.findProfile(profileList, item.employeeCode)?.username;
      assertLeaveApprover(freshUser, empUsername, users);
      return attendance.applyRejectLeaveRequest(item, freshUser.username, freshUser.name, req.body?.reason);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `leaveRequests/${req.params.id}/reject`, err);
  }
});

// attendanceRecords: HR sửa tay 1 bản ghi công (máy chấm công lỗi/thiếu quẹt thẻ).
router.post('/attendanceRecords/:id/edit', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    if (!freshUser.perms?.admin && !freshUser.perms?.hrAttendanceManage) throw new HttpError(403, 'Bạn không có quyền sửa bản ghi chấm công');
    const result = await withLockedRecordForCollection('attendanceRecords', itemId, (item) =>
      attendance.applyManualAttendanceEdit(item, req.body, freshUser.username));
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `attendanceRecords/${req.params.id}/edit`, err);
  }
});
router.post('/attendanceRecords/:id/delete', (req, res) => deleteAdminOnly(req, res, 'attendanceRecords'));

// leaveBalances: HR điều chỉnh tay (carry-over, quyết định riêng của công ty).
router.post('/leaveBalances/:id/adjust', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    if (!freshUser.perms?.admin && !freshUser.perms?.hrAttendanceManage) throw new HttpError(403, 'Bạn không có quyền điều chỉnh phép năm');
    const totalDays = Number(req.body?.totalDays);
    if (!Number.isFinite(totalDays) || totalDays < 0 || totalDays > 60) throw new HttpError(400, 'Tổng số ngày phép không hợp lệ');
    const result = await withLockedRecordForCollection('leaveBalances', itemId, (item) => {
      item.totalDays = totalDays;
      item.updatedAt = new Date().toLocaleString('vi-VN');
      return item;
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `leaveBalances/${req.params.id}/adjust`, err);
  }
});
router.post('/leaveBalances/:id/delete', (req, res) => deleteAdminOnly(req, res, 'leaveBalances'));

// shiftRoster: Quản Lý Siêu Thị/HR huỷ 1 dòng phân ca.
router.post('/shiftRoster/:id/cancel', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const result = await withLockedRecordForCollection('shiftRoster', itemId, (item) => {
      if (!freshUser.perms?.admin && !freshUser.perms?.hrAttendanceManage
        && !(freshUser.perms?.hrShiftRosterManage && item.storeCode === freshUser.dept)) {
        throw new HttpError(403, 'Bạn không có quyền huỷ lịch phân ca này');
      }
      return attendance.applyCancelRoster(item, freshUser.username);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `shiftRoster/${req.params.id}/cancel`, err);
  }
});
router.post('/shiftRoster/:id/delete', (req, res) => deleteAdminOnly(req, res, 'shiftRoster'));

// shiftSwapRequests: Quản Lý Siêu Thị (đúng siêu thị của ca liên quan) hoặc HR duyệt/từ chối đổi ca.
function assertShiftSwapApprover(freshUser, roster) {
  const allowed = freshUser.perms?.admin || freshUser.perms?.hrAttendanceManage
    || (freshUser.perms?.hrShiftSwapApprove && roster && roster.storeCode === freshUser.dept);
  if (!allowed) throw new HttpError(403, 'Bạn không có quyền duyệt yêu cầu đổi ca này');
}

router.post('/shiftSwapRequests/:id/approve', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const rosterList = await getAllForCollection('shiftRoster');
    let updatedRosterId = null, updatedRosterPatch = null;
    const result = await withLockedRecordForCollection('shiftSwapRequests', itemId, (item) => {
      const targetRoster = rosterList.find(r => r.id === item.requesterRosterId);
      assertShiftSwapApprover(freshUser, targetRoster);
      const { updatedSwap, updatedRoster } = attendance.applyApproveShiftSwap(item, targetRoster, freshUser.username, freshUser.name);
      updatedRosterId = updatedRoster.id; updatedRosterPatch = updatedRoster;
      return updatedSwap;
    });
    if (updatedRosterId) await withLockedRecordForCollection('shiftRoster', updatedRosterId, () => updatedRosterPatch);
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `shiftSwapRequests/${req.params.id}/approve`, err);
  }
});

router.post('/shiftSwapRequests/:id/reject', async (req, res) => {
  const itemId = Number(req.params.id);
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    const { freshUser } = await getFreshUser(req);
    const rosterList = await getAllForCollection('shiftRoster');
    const result = await withLockedRecordForCollection('shiftSwapRequests', itemId, (item) => {
      const targetRoster = rosterList.find(r => r.id === item.requesterRosterId);
      assertShiftSwapApprover(freshUser, targetRoster);
      return attendance.applyRejectShiftSwap(item, freshUser.username, freshUser.name);
    });
    res.json({ ok: true, item: result });
  } catch (err) {
    handleError(res, `shiftSwapRequests/${req.params.id}/reject`, err);
  }
});
router.post('/shiftSwapRequests/:id/delete', (req, res) => deleteAdminOnly(req, res, 'shiftSwapRequests'));

module.exports = router;
// Export riêng cho test (tests/test-operation-danhmuc-dautu-units.js) — xác nhận route xoá
// operationStoreOpenings/operationRepairs LUÔN từ chối, không phụ thuộc quyền/trạng thái người gọi.
module.exports.rejectOperationDelete = rejectOperationDelete;
