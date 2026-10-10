// routes/workflow.js — Bước 1 (phương án C bảo mật): server tự xác minh đúng bước quy trình duyệt
// trước khi ghi, thay vì tin nguyên collection mà client tự tính toán rồi POST đè lên (routes/data.js
// cũ). Trước đây bất kỳ ai có phiên đăng nhập hợp lệ (không cần là approver) đều có thể tự soạn
// request tới POST /api/data/submissions để tự duyệt hồ sơ của chính mình.
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getAllAppData } = require('../lib/appData');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { MODULE_CONFIGS, WorkflowError, applyWorkflowAction, resolveWorkflowStepApprovers, canApproveStep } = require('../lib/workflowEngine');
const { assertUploadedFileUrl } = require('../lib/createValidation');
const recordActions = require('../lib/recordActions');
const { insertTask } = require('../lib/taskStore');
const { withLockedRecordForCollection, getAllForCollection, withAppLock } = require('../lib/recordStore');
const { consumeApprovalGrant } = require('../lib/approvalAuth');
// Thông báo EMAIL cho hành động chuyển tiếp/trả lời ý kiến — CỐ Ý KHÔNG gửi ở đây: toàn bộ ~88 điểm gửi
// email "Cần phê duyệt"/"Xin ý kiến"/... hiện có đều gọi notifyUsersByEmail() phía CLIENT (public/js/
// core.js, dùng DB.users đã tải sẵn để tra email + tôn trọng cờ tắt email cá nhân/module), KHÔNG có lệ
// nào gửi email ngay tại route server — giữ đúng quy ước đó, client tự gọi sau khi route này trả về
// 200 OK (xem submitForward()/submitForwardReply() ở core.js). Chuông thông báo trong app thì NGƯỢC
// LẠI — lib/notifications.js::notifyUsers() là hàm SERVER thật (ghi thẳng dbo.Records collection
// 'notifications'), gọi được trực tiếp tại đây.
const { notifyUsers } = require('../lib/notifications');
// LỖI ĐÃ VÁ (đợt rà soát chuyên sâu vòng 2, mức Cao — "propose-file-replacement không xác minh quyền
// sở hữu tệp"): PROPOSE_FILE_REPLACEMENT (lib/workflowEngine.js) trước đây chỉ kiểm ĐÚNG KHUÔN URL
// (assertUploadedFileUrl) cho extraFields.fileUrl, không xác minh approver ở bước hiện tại có thật sự
// là người vừa tải tệp đó lên hay không — cho phép trỏ fileUrl sang tệp nhạy cảm của hồ sơ BẤT KỲ khác
// rồi findOwningRecord() (lib/fileAuthz.js) quy nhầm tệp đó về tờ trình đang xử lý, lộ cho approver và
// (nếu người trình bấm Đồng ý) ghi thẳng vào item.fileUrl khiến cả phòng ban đọc được vĩnh viễn. Đây là
// đường ghi fileUrl DUY NHẤT trong route generic này (route riêng khác của module này không có), và
// applyWorkflowAction() là hàm ĐỒNG BỘ (dùng chung cho mọi module/hành động) nên không thể gọi thẳng
// hàm kiểm DB bất đồng bộ này từ bên trong nó — kiểm NGAY TẠI ROUTE, trước khi vào lock/ghi, đúng khuôn
// 14 route sửa/tạo khác đã áp dụng (xem routes/create.js:192, routes/records.js).
const { assertPayloadFileUrlsOwnedByUser } = require('../lib/uploadedFiles');
const { hasModuleAccessServer, canAccessItPriceApprovalModuleServer } = require('../lib/recordViewScope');

router.use(requireAuth, blockIfMustChangePassword);

// LỖI ĐÃ VÁ (đợt audit chuyên sâu 12 cụm, mức Trung bình — phát hiện #14): đường DUYỆT (route generic
// bên dưới, dùng chung cho MỌI module trong MODULE_CONFIGS) TRƯỚC ĐÂY hoàn toàn không kiểm
// hasModuleAccessServer() ("Khối 0", user.perms.moduleAccess) — nguyên tắc "Khối 0 chặn trước tiên" đã áp
// dụng cho TẠO/ĐỌC (xem routes/create.js/routes/data.js) nhưng bị bỏ sót ở đường Duyệt/Từ chối/Yêu cầu bổ
// sung: admin tắt hẳn 1 module cho 1 tài khoản cụ thể (VD tạm khoá "Vận Hành" cho người vừa đổi vai trò)
// chỉ ẩn được tab ở giao diện — nếu người đó VẪN còn nằm trong danh sách approver của 1 bước duyệt (cấu
// hình dept-workflow chưa kịp gỡ), gọi thẳng API vẫn duyệt được bình thường. Map CỤC BỘ ở đây (KHÔNG thêm
// vào MODULE_ACCESS_GATED_COLLECTIONS dùng chung ở GET /api/data — phát hiện này chỉ về đường GHI/hành
// động, không đổi phạm vi lọc ĐỌC dữ liệu) từ dbKey của MODULE_CONFIGS sang đúng khoá moduleAccess tương
// ứng (BUSINESS_MODULES, public/js/core.js).
const WORKFLOW_MODULE_ACCESS_KEYS = {
  docs: 'doc', submissions: 'submission', carRegs: 'car', officeReqs: 'office',
  vppRegistrations: 'vpp', contracts: 'contract', contractsSignedFile: 'contract',
  budgetEntries: 'budget', operationOrders: 'vanHanh',
  paymentRequests: 'office'
  // itPriceApprovals CỐ Ý không có mặt ở đây nữa — xem nhánh riêng trong assertWorkflowModuleAccess()
  // ngay dưới (LỖI ĐÃ VÁ, đợt audit chuyên sâu 8-agent song song, mức Cao).
};
// itPriceApprovals — trước đây tra CỨNG theo 'itSupport' bất kể priceType, chặn nhầm người chỉ có
// moduleAccess.muaHang (Bán Lẻ)/vanHanh (Bán Buôn) dù đủ quyền chi tiết duyệt (đúng thiết kế MỚI sau đợt
// tách Item2) — mirror ĐÚNG canAccessItPriceApprovalModuleServer() (lib/recordViewScope.js). `priceType`
// chỉ có khi đã tải được bản ghi (item.priceType) — nơi gọi cho module này PHẢI gọi lại hàm này SAU KHI
// đã khoá+đọc được item (xem runApprove() bên dưới), không gọi ở đầu route như các module khác.
function assertWorkflowModuleAccess(user, moduleKey, priceType, appData) {
  if (moduleKey === 'itPriceApprovals') {
    if (!canAccessItPriceApprovalModuleServer(user, priceType, appData)) {
      throw new WorkflowError(403, 'Module này đã bị khoá cho tài khoản của bạn — liên hệ Quản Trị Viên nếu cần mở lại');
    }
    return;
  }
  const accessKey = WORKFLOW_MODULE_ACCESS_KEYS[moduleKey];
  if (accessKey && !hasModuleAccessServer(user, accessKey)) {
    throw new WorkflowError(403, 'Module này đã bị khoá cho tài khoản của bạn — liên hệ Quản Trị Viên nếu cần mở lại');
  }
}

// 'propose-file-replacement'/'resolve-file-proposal' — CHỈ Văn Bản Trình, lớp Bộ phận Trợ Lý/Thư Ký
// (TRO_LY_THU_KY, luôn ngay trước TGD) đề xuất thay thế toàn bộ tệp tờ trình thay vì REQUEST_CHANGES
// thường, người trình xác nhận đồng ý/không đồng ý — xem applyWorkflowAction() ở lib/workflowEngine.js.
const ACTION_MAP = {
  approve: 'APPROVE', reject: 'REJECT', 'request-info': 'REQUEST_INFO', 'request-changes': 'REQUEST_CHANGES',
  'propose-file-replacement': 'PROPOSE_FILE_REPLACEMENT', 'resolve-file-proposal': 'RESOLVE_FILE_PROPOSAL',
  // 'cancel-file-proposal' — lối thoát cho tờ trình bị khoá cứng bởi 1 đề xuất thay thế treo mãi (admin
  // hoặc chính người đã đề xuất tự rút lại), xem CANCEL_FILE_PROPOSAL ở lib/workflowEngine.js.
  'cancel-file-proposal': 'CANCEL_FILE_PROPOSAL'
};

// Xác thực bổ sung khi Duyệt (mật khẩu/OTP/PIN, perms.approverAuthLevel) — áp dụng cho MỌI module dùng
// chung engine phê duyệt này (MODULE_CONFIGS). Trước đây chỉ khai đúng 3/7 module (submissions/carRegs/
// officeReqs, khớp withApprovalAuth() ở giao diện lúc đó) — người dùng cấu hình approverAuthLevel với
// chủ đích áp dụng cho MỌI lượt Duyệt của mình, nhưng Tài Liệu/Hợp Đồng/Tài liệu ký hợp đồng/VPP lại
// hoàn toàn không được bảo vệ mà không ai biết. Nay lấy trực tiếp từ MODULE_CONFIGS thay vì khai tay
// lại 1 danh sách con dễ lệch mỗi khi thêm module mới — index.html cũng đã gọi withApprovalAuth() ở
// đủ cả 7 nơi tương ứng (approveDoc/approveContractAction/approveContractSignedFileAction/
// processSubmission/processCarReg/processOfficeReq/processVppReg).
const APPROVAL_REAUTH_MODULES = new Set(Object.keys(MODULE_CONFIGS));

// POST /api/workflow/submissions/:id/give-opinion — người được XIN Ý KIẾN (sub.opinionRequestees,
// xem lib/createValidation.js) để lại ý kiến tham khảo. KHÔNG phải hành động Duyệt/Từ chối, KHÔNG đi
// qua applyWorkflowAction/lib/workflowEngine.js — kênh song song, không chặn quy trình duyệt chính,
// nên KHÔNG kiểm tra item.status/currentStep (được phép để ý kiến ở bất kỳ trạng thái/bước nào).
// PHẢI đăng ký TRƯỚC route generic /:module/:id/:action bên dưới — route đó cũng khớp cấu trúc
// "/submissions/<id>/give-opinion" (module=submissions, id=<id>, action=give-opinion), Express khớp
// theo đúng THỨ TỰ đăng ký nên nếu để sau, route generic sẽ luôn chặn trước (action "give-opinion"
// không có trong ACTION_MAP -> luôn trả 400, route riêng bên dưới không bao giờ được gọi tới).
router.post('/submissions/:id/give-opinion', async (req, res) => {
  const itemId = Number(req.params.id);
  const { comment } = req.body || {};
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  if (!comment) return res.status(400).json({ error: 'Vui lòng nhập ý kiến' });

  try {
    const freshUser = req.freshUser;
    // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu mới, mức Trung bình): assertWorkflowModuleAccess() TRƯỚC ĐÂY chạy
    // TRƯỚC khi biết người gọi có phải opinionRequestee hợp lệ hay không — chặn cứng ngay cả người ĐÚNG
    // được xin ý kiến (thường là người KHÔNG dùng module Văn Bản Trình thường xuyên, đúng lý do admin tắt
    // moduleAccess.submission cho họ). Đọc bản ghi TRƯỚC (trong khoá), chỉ áp Khối 0 khi KHÔNG phải
    // opinionRequestee hợp lệ — giữ nguyên chặn cho mọi trường hợp khác.
    const resultItem = await withLockedRecordForCollection('submissions', itemId, (sub) => {
      const requestees = sub.opinionRequestees || [];
      if (!requestees.includes(freshUser.username)) {
        assertWorkflowModuleAccess(freshUser, 'submissions');
        throw new WorkflowError(403, 'Bạn không thuộc danh sách được xin ý kiến ở tờ trình này');
      }
      if (!sub.opinionResponses) sub.opinionResponses = [];
      const now = new Date().toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      const existing = sub.opinionResponses.find(r => r.username === freshUser.username);
      if (existing) {
        existing.comment = comment;
        existing.respondedAt = now;
      } else {
        sub.opinionResponses.push({ username: freshUser.username, name: freshUser.name, comment, respondedAt: now });
      }
      if (!sub.history) sub.history = [];
      sub.history.push({
        step: sub.currentStep, approver: freshUser.name, username: freshUser.username,
        action: 'GIVE_OPINION', comment, time: now
      });

      return sub;
    });

    res.json({ ok: true, item: resultItem });
  } catch (err) {
    if (err instanceof WorkflowError) return res.status(err.status).json({ error: err.message });
    console.error(`POST /api/workflow/submissions/${req.params.id}/give-opinion lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể xử lý yêu cầu' });
  }
});

// ====== Chuyển Tiếp Xin Ý Kiến (submissions/contracts) ======================================
// Nhánh "song song" độc lập với luồng duyệt chạy ngang chính (status/currentStep/history) — cùng
// triết lý với route give-opinion ở trên: KHÔNG đi qua applyWorkflowAction(), không đụng tới
// status/currentStep/history của hồ sơ. Lưu vào mảng phẳng item.forwardThreads[], mỗi phần tử là
// 1 "cạnh" (edge) chuyển tiếp riêng — CHỈ 2 người forwardedBy/forwardedTo của đúng cạnh đó nhìn
// thấy được (lib/recordViewScope.js sẽ dựa vào đúng 2 field này để cấp quyền xem bổ sung, xem task
// #441) — tự nhiên đáp ứng đúng yêu cầu "không xem được chéo cấp" mà không cần duyệt cây đệ quy.
const FORWARD_SUPPORTED_MODULES = new Set(['submissions', 'contracts']);
const MAX_FORWARD_TARGETS = 20;
const MAX_FORWARD_MESSAGE_LEN = 1000;
const MAX_FORWARD_REPLY_LEN = 2000;

function nowVN() {
  return new Date().toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
}

function assertForwardModuleSupported(moduleKey) {
  if (!FORWARD_SUPPORTED_MODULES.has(moduleKey)) {
    throw new WorkflowError(400, `Module không hỗ trợ Chuyển Tiếp Xin Ý Kiến: ${moduleKey}`);
  }
}

// POST /api/workflow/:module/:id/forward — tạo 1 hoặc nhiều "cạnh" chuyển tiếp mới, gắn vào đúng
// bước (root forward, người gọi phải là approver LIVE của item.currentStep) hoặc nối tiếp bên dưới
// 1 cạnh đã có (continuation forward, người gọi phải là forwardedTo của parentNodeId đó — đúng
// nghĩa "chuyển tiếp tiếp cho người khác" theo yêu cầu, KHÔNG cho phép chuyển tiếp hộ người khác).
router.post('/:module/:id/forward', async (req, res) => {
  const moduleKey = req.params.module;
  const itemId = Number(req.params.id);
  const { targetUsernames, message, parentNodeId } = req.body || {};
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });

  try {
    assertForwardModuleSupported(moduleKey);
    const freshUser = req.freshUser;
    assertWorkflowModuleAccess(freshUser, moduleKey);

    const targets = Array.from(new Set((Array.isArray(targetUsernames) ? targetUsernames : [])
      .map(u => String(u || '').trim()).filter(Boolean)));
    if (!targets.length) return res.status(400).json({ error: 'Vui lòng chọn ít nhất 1 người để chuyển tiếp' });
    if (targets.length > MAX_FORWARD_TARGETS) {
      return res.status(400).json({ error: `Chỉ được chuyển tiếp tối đa ${MAX_FORWARD_TARGETS} người/lượt` });
    }
    if (targets.includes(freshUser.username)) {
      return res.status(400).json({ error: 'Không thể chuyển tiếp cho chính mình' });
    }
    const msg = String(message || '').trim();
    if (msg.length > MAX_FORWARD_MESSAGE_LEN) {
      return res.status(400).json({ error: `Ghi chú chuyển tiếp tối đa ${MAX_FORWARD_MESSAGE_LEN} ký tự` });
    }

    const usersList = req.allUsers || [];
    const targetUserRows = targets.map(username => {
      const u = usersList.find(x => x.username === username && x.active !== false);
      if (!u) throw new WorkflowError(400, `Người dùng không hợp lệ hoặc đã ngưng hoạt động: ${username}`);
      return u;
    });

    const appData = await getAllAppData();
    const parentId = parentNodeId != null ? String(parentNodeId) : null;

    const resultItem = await withLockedRecordForCollection(MODULE_CONFIGS[moduleKey].dbKey, itemId, (item) => {
      if (!Array.isArray(item.forwardThreads)) item.forwardThreads = [];
      let step;
      if (parentId) {
        const parentNode = item.forwardThreads.find(n => n.id === parentId);
        if (!parentNode) throw new WorkflowError(404, 'Không tìm thấy nhánh chuyển tiếp gốc');
        if (parentNode.forwardedTo !== freshUser.username) {
          throw new WorkflowError(403, 'Bạn không phải người được chuyển tiếp ở nhánh này nên không thể chuyển tiếp tiếp');
        }
        step = parentNode.step;
      } else {
        step = item.currentStep;
        const approvers = resolveWorkflowStepApprovers(moduleKey, item, appData, step);
        if (!canApproveStep(freshUser, approvers, item.history, step)) {
          throw new WorkflowError(403, 'Bạn không phải người phê duyệt bước hiện tại nên không thể chuyển tiếp xin ý kiến');
        }
      }

      const now = nowVN();
      const createdNodes = targetUserRows.map(u => {
        const node = {
          id: crypto.randomUUID(),
          step,
          parentNodeId: parentId,
          forwardedBy: freshUser.username,
          forwardedByName: freshUser.name,
          forwardedTo: u.username,
          forwardedToName: u.name,
          message: msg || null,
          forwardedAt: now,
          reply: null
        };
        item.forwardThreads.push(node);
        return node;
      });
      item._justCreatedForwardNodes = createdNodes; // đọc lại ngay dưới, không lưu vào DB
      return item;
    });

    const createdNodes = resultItem._justCreatedForwardNodes || [];
    delete resultItem._justCreatedForwardNodes;

    const title = resultItem.title || resultItem.code || `#${itemId}`;
    for (const node of createdNodes) {
      await notifyUsers([node.forwardedTo], 'FORWARD_OPINION_REQUESTED',
        'Được nhờ cho ý kiến',
        `${freshUser.name} nhờ bạn cho ý kiến về "${title}"${msg ? `: ${msg}` : ''}`,
        // '/forward?module=...&code=...' — DÙNG RIÊNG (không phải khuôn '/?gotoModule=...' của email, vốn
        // chỉ đọc lúc TẢI TRANG qua gotoApprovalResultRecordFromQueryParam()) vì bấm chuông thông báo là
        // điều hướng SPA (không tải lại trang) — onClickNotifItem() (core.js) tự parse đúng khuôn này để
        // mở thẳng modal chi tiết kèm khối "🔀 Chuyển Tiếp Xin Ý Kiến" của đúng hồ sơ.
        `/forward?module=${moduleKey}&code=${encodeURIComponent(resultItem.code || '')}`);
    }

    res.json({ ok: true, item: resultItem, createdNodes });
  } catch (err) {
    if (err instanceof WorkflowError) return res.status(err.status).json({ error: err.message });
    console.error(`POST /api/workflow/${moduleKey}/${req.params.id}/forward lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể xử lý yêu cầu' });
  }
});

// POST /api/workflow/:module/:id/forward-reply — người ĐƯỢC chuyển tiếp (forwardedTo của đúng
// node) trả lời lại CHÍNH người đã chuyển tiếp cho mình (forwardedBy) — không có quyền trả lời hộ
// node khác, không có quyền sửa lại reply đã gửi (idempotent theo đúng thiết kế give-opinion:
// ở đây CHẶN gửi lại, khác give-opinion cho phép sửa — vì đây là 1 lượt hỏi-đáp 1 lần, không phải ý
// kiến có thể cập nhật nhiều lần theo thời gian).
router.post('/:module/:id/forward-reply', async (req, res) => {
  const moduleKey = req.params.module;
  const itemId = Number(req.params.id);
  const { nodeId, comment, fileUrl } = req.body || {};
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'id không hợp lệ' });
  if (!nodeId) return res.status(400).json({ error: 'Thiếu nodeId' });

  const cmt = String(comment || '').trim();
  if (cmt.length > MAX_FORWARD_REPLY_LEN) {
    return res.status(400).json({ error: `Ý kiến trả lời tối đa ${MAX_FORWARD_REPLY_LEN} ký tự` });
  }
  if (!cmt && !fileUrl) {
    return res.status(400).json({ error: 'Vui lòng nhập ý kiến hoặc đính kèm file' });
  }

  try {
    assertForwardModuleSupported(moduleKey);
    const freshUser = req.freshUser;
    assertWorkflowModuleAccess(freshUser, moduleKey);
    if (fileUrl) assertUploadedFileUrl(fileUrl, 'File ý kiến trả lời');

    const resultItem = await withLockedRecordForCollection(MODULE_CONFIGS[moduleKey].dbKey, itemId, (item) => {
      const node = (item.forwardThreads || []).find(n => n.id === String(nodeId));
      if (!node) throw new WorkflowError(404, 'Không tìm thấy nhánh chuyển tiếp');
      if (node.forwardedTo !== freshUser.username) {
        throw new WorkflowError(403, 'Bạn không phải người được chuyển tiếp ở nhánh này');
      }
      if (node.reply) {
        throw new WorkflowError(409, 'Nhánh này đã được trả lời trước đó');
      }
      node.reply = {
        comment: cmt || null,
        fileUrl: fileUrl || null,
        repliedAt: nowVN()
      };
      return item;
    });

    const node = (resultItem.forwardThreads || []).find(n => n.id === String(nodeId));
    const title = resultItem.title || resultItem.code || `#${itemId}`;
    if (node) {
      await notifyUsers([node.forwardedBy], 'FORWARD_OPINION_REPLIED',
        'Đã có phản hồi ý kiến',
        `${freshUser.name} đã trả lời ý kiến bạn nhờ về "${title}"`,
        `/forward?module=${moduleKey}&code=${encodeURIComponent(resultItem.code || '')}`);
    }

    res.json({ ok: true, item: resultItem });
  } catch (err) {
    if (err instanceof WorkflowError) return res.status(err.status).json({ error: err.message });
    console.error(`POST /api/workflow/${moduleKey}/${req.params.id}/forward-reply lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể xử lý yêu cầu' });
  }
});

// POST /api/workflow/:module/:id/:action  (module: docs|submissions|carRegs|officeReqs)
router.post('/:module/:id/:action', async (req, res) => {
  const { module: moduleKey, id, action: rawAction } = req.params;

  if (!MODULE_CONFIGS[moduleKey]) {
    return res.status(400).json({ error: `Module không hợp lệ: ${moduleKey}` });
  }
  const action = ACTION_MAP[rawAction];
  if (!action) {
    return res.status(400).json({ error: `Hành động không hợp lệ: ${rawAction}` });
  }
  const itemId = Number(id);
  if (!Number.isFinite(itemId)) {
    return res.status(400).json({ error: 'id không hợp lệ' });
  }

  const { comment, extraFields } = req.body || {};

  try {
    // Ngữ cảnh tra cứu cấu hình quy trình — requireAuth đã tự xác định lại CHÍNH XÁC người dùng hiện
    // tại từ DB (kể cả trạng thái active) và gắn sẵn vào req.freshUser, không cần đọc lại lần nữa.
    const appData = await getAllAppData();
    const freshUser = req.freshUser;
    // itPriceApprovals: kiểm SAU KHI đã tải được item (cần item.priceType) — xem runApprove() bên dưới.
    if (moduleKey !== 'itPriceApprovals') assertWorkflowModuleAccess(freshUser, moduleKey);

    // Trước đây "xác thực lại mật khẩu/OTP/PIN trước khi Duyệt" (withApprovalAuth() ở index.html) chỉ
    // là lớp UI thuần JS — xác thực xong rồi mới GỌI HÀM duyệt thật ở trình duyệt, nhưng route này
    // không hề biết/kiểm tra lại việc đó đã xảy ra: gọi thẳng API vẫn duyệt được luôn dù tài khoản đã
    // cấu hình approverAuthLevel khác NONE. Giờ đòi đúng 1 "phiếu" đã cấp bởi POST /api/auth/
    // verify-password|verify-pin|verify-approval-otp (xem lib/approvalAuth.js), dùng 1 lần cho lượt
    // Duyệt này rồi mất — không áp dụng cho Từ chối/Yêu cầu bổ sung (khớp đúng phạm vi UI cũ).
    if (action === 'APPROVE' && APPROVAL_REAUTH_MODULES.has(moduleKey)) {
      const level = freshUser.perms?.approverAuthLevel || 'NONE';
      if (level !== 'NONE' && !(await consumeApprovalGrant(freshUser.username))) {
        return res.status(403).json({ error: 'Cần xác thực lại (mật khẩu/OTP/PIN) trước khi duyệt' });
      }
    }

    // Xác minh quyền sở hữu tệp thay thế NGAY tại đây (trước khi vào lock/ghi) — xem chú thích đầy đủ ở
    // import assertPayloadFileUrlsOwnedByUser phía trên. Không cần exemptFileUrls: đây luôn là 1 tệp MỚI
    // được đề xuất (không phải giữ nguyên tệp cũ của chính hồ sơ), nên không có URL nào cần miễn kiểm.
    if (action === 'PROPOSE_FILE_REPLACEMENT') {
      await assertPayloadFileUrlsOwnedByUser({ fileUrl: extraFields?.fileUrl }, freshUser);
    }

    // Kỹ Thuật Xác Nhận (11/2026, officeReqs/Sửa Chữa) — ảnh/tài liệu hiện trường do CHÍNH người xác
    // nhận kỹ thuật vừa tải lên khi Duyệt ở đúng bước kỹ thuật (xem khối validate ở applyWorkflowAction()
    // trong lib/workflowEngine.js) — cùng lớp kiểm sở hữu tệp như PROPOSE_FILE_REPLACEMENT ở trên.
    if (moduleKey === 'officeReqs' && action === 'APPROVE' && extraFields?.techAssessmentFileUrls) {
      await assertPayloadFileUrlsOwnedByUser({ techAssessmentFileUrls: extraFields.techAssessmentFileUrls }, freshUser);
    }

    let transition = null;

    // carRegs: cần đọc trước toàn bộ collection để kiểm tra trùng biển số/khung giờ ngay lúc gán biển
    // số ở bước duyệt (xem findCarPlateConflict() ở lib/workflowEngine.js). withLockedRecordForCollection
    // bên dưới chỉ khoá ĐÚNG 1 dòng carReg đang duyệt (theo Id) — 2 yêu cầu duyệt 2 phiếu KHÁC NHAU
    // cùng gán 1 biển số trùng khung giờ CÙNG LÚC vẫn có thể cùng đọc collection "chưa ai gán trùng"
    // trước khi cả hai kịp ghi, race y hệt lý do findMeetingConflict()/getLockKey() cần
    // createForCollectionSerialized() ở lib/createValidation.js cho lịch phòng họp lúc TẠO. Khoá thêm
    // bằng withAppLock() theo GIÁ TRỊ BIỂN SỐ đang gán (không phải theo Id phiếu) bọc quanh toàn bộ
    // đọc-kiểm tra-ghi để chặn đúng race này; chỉ cần khi có gán biển số mới (assignedPlate được gửi).
    // PHÁT HIỆN ở đợt audit chuyên sâu lần 2: reassignCarDispatch() (lib/recordActions.js) trim biển số
    // trước khi so sánh/lưu/dựng khoá, nhánh APPROVE này trước đây KHÔNG trim — 2 yêu cầu cùng 1 biển số
    // thật nhưng lệch khoảng trắng (VD " 51A-111.11" vs "51A-111.11") bị coi là 2 biển số KHÁC NHAU, vừa
    // lọt qua findCarPlateConflict() (so sánh === thô, xem lib/workflowEngine.js), vừa dựng 2 khoá
    // withAppLock() khác nhau nên mất tác dụng chống race. Trim ngay tại đây để khoá + applyWorkflowAction()
    // dùng thống nhất 1 giá trị.
    const newPlate = moduleKey === 'carRegs' ? String(extraFields?.assignedPlate || '').trim() || null : null;
    if (moduleKey === 'carRegs' && extraFields && typeof extraFields.assignedPlate === 'string') {
      extraFields.assignedPlate = extraFields.assignedPlate.trim();
    }
    // LỖI ĐÃ VÁ (đợt rà soát chuyên sâu 10/2026): applyWorkflowAction() giờ đã kiểm tra trùng TÀI XẾ
    // (findCarDriverConflict(), mirror findCarPlateConflict() — trước đó module này hoàn toàn KHÔNG có
    // kiểm tra này, 1 tài xế có thể bị gán lái 2 xe khác biển số cùng khung giờ) — khoá thêm theo GIÁ
    // TRỊ TÀI XẾ đang gán (cùng lý do/cùng khuôn khoá biển số ở trên) để 2 lượt duyệt gán CÙNG 1 tài xế
    // cho 2 phiếu KHÁC NHAU gần như đồng thời không cùng đọc snapshot "chưa ai gán" trước khi cả hai ghi.
    const newDriverUsername = moduleKey === 'carRegs' ? String(extraFields?.assignedDriverUsername || '').trim() || null : null;
    const lockKeys = [];
    if (newPlate) lockKeys.push(`car_plate:${newPlate}`);
    if (newDriverUsername) lockKeys.push(`car_driver:${newDriverUsername}`);
    const runApprove = async () => {
      const existingCollection = moduleKey === 'carRegs' ? await getAllForCollection('carRegs') : null;
      return withLockedRecordForCollection(MODULE_CONFIGS[moduleKey].dbKey, itemId, (item) => {
        if (moduleKey === 'itPriceApprovals') assertWorkflowModuleAccess(freshUser, moduleKey, item.priceType, appData);
        const outcome = applyWorkflowAction({
          moduleKey, item, action, user: freshUser, comment, extraFields, appData, existingCollection, users: req.allUsers
        });
        transition = outcome.transition;
        return outcome.item;
      });
    };
    const resultItem = lockKeys.length
      ? await withAppLock(lockKeys, runApprove)
      : await runApprove();

    // Tờ trình được phê duyệt HOÀN TẤT (bước cuối cùng) kèm ý kiến chỉ đạo -> tự tạo 1 Công việc theo
    // dõi (chưa gán người nhận). Trước đây client tự dựng + ghi thẳng qua POST /api/data/tasks (route
    // generic, không xác minh gì) — cùng dạng lỗ hổng đã vá ở các module khác, nay chuyển vào server
    // ngay tại điểm server đã tự xác nhận transition.type === 'COMPLETED' (không tin client báo lại).
    let createdTask = null;
    if (moduleKey === 'submissions' && transition.type === 'COMPLETED' && comment) {
      createdTask = recordActions.buildTaskFromSubmissionComment(resultItem, freshUser, comment);
      await insertTask(createdTask);
    }

    // v15.8 — đề nghị thanh toán (paymentRequests) duyệt xong TOÀN BỘ quy trình theo bước/phòng ban
    // (transition COMPLETED, item.status -> APPROVED) -> ghi ngược paymentStatus = CHO_THANH_TOAN về bản
    // ghi nguồn (Hợp đồng/officeReqs) NGAY LÚC NÀY — trước đây (< v15.8) việc này bị gán quá sớm, ngay
    // lúc tạo NHÁP (xem lib/recordActions.js startContractPayment()/startOfficePayment()), khiến "Chờ
    // thanh toán" hiện ra dù đề nghị còn chưa qua duyệt phòng ban. Cùng khuôn khối ghi ngược PAID ở
    // routes/records.js (withPaymentConfirmAction()) — chỉ khác: ghi ngay (không cần đợi isCycleGroupFullyResolved(),
    // vì CHO_THANH_TOAN chỉ có ý nghĩa "có 1 đợt đang xử lý", không cần đợi CẢ lô cùng xong như DA_THANH_TOAN).
    if (moduleKey === 'paymentRequests' && transition.type === 'COMPLETED'
        && resultItem.sourceModule && resultItem.sourceId != null) {
      const sourceCollection = resultItem.sourceModule === 'CONTRACT' ? 'contracts' : 'officeReqs';
      await withLockedRecordForCollection(sourceCollection, resultItem.sourceId, (item) => {
        if (item.paymentStatus === 'CHUA_THANH_TOAN') item.paymentStatus = 'CHO_THANH_TOAN';
        return item;
      }).catch(() => {}); // nguồn có thể đã bị xoá — không chặn việc đề nghị thanh toán đã duyệt hợp lệ
    }

    res.json({ ok: true, item: resultItem, transition, createdTask });
  } catch (err) {
    if (err instanceof WorkflowError) return res.status(err.status).json({ error: err.message });
    console.error(`POST /api/workflow/${moduleKey}/${id}/${rawAction} lỗi:`, err.message);
    res.status(500).json({ error: 'Không thể xử lý yêu cầu' });
  }
});

module.exports = router;
