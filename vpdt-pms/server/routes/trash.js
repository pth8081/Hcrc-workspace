// routes/trash.js — Thùng Rác: xem/khôi phục/xóa vĩnh viễn các hồ sơ đã bị admin xóa ở bất kỳ
// collection nào trong dbo.Records. Từ giờ "Xóa" ở mọi module nghiệp vụ (xem
// deleteRecordForCollection() ở lib/recordStore.js) không còn xóa thẳng nữa mà CHUYỂN vào
// dbo.TrashBin — route này là nơi DUY NHẤT thao tác với dữ liệu đã chuyển vào đó.
//
// Admin-only cho cả 3 hành động — khớp đúng phạm vi: chỉ Quản Trị Viên mới xóa được các hồ sơ này ngay
// từ đầu (xem assertAdminForDelete() ở routes/records.js), nên chỉ Quản Trị Viên mới cần/được xem lại
// Thùng Rác.
const express = require('express');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { HttpError } = require('../lib/httpErrors');
const { getTrashItems, restoreTrashItemWithFamily, permanentlyDeleteTrashItem } = require('../lib/recordStore');
const { consumeApprovalGrant } = require('../lib/approvalAuth');

router.use(requireAuth, blockIfMustChangePassword);

function assertAdmin(user) {
  if (!user.perms?.admin) throw new HttpError(403, 'Chỉ Quản Trị Viên mới có quyền truy cập Thùng Rác');
}

function handleError(res, action, err) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(`Thùng Rác ${action} lỗi:`, err.message);
  res.status(500).json({ error: 'Không thể xử lý yêu cầu' });
}

// GET /api/trash?collection=xxx (collection tuỳ chọn, không truyền = liệt kê MỌI collection)
router.get('/', async (req, res) => {
  try {
    assertAdmin(req.freshUser);
    const items = await getTrashItems(req.query.collection || null);
    res.json({ items });
  } catch (err) {
    handleError(res, 'GET /', err);
  }
});

// POST /api/trash/:id/restore — khôi phục lại ĐÚNG Id/Collection gốc. Chặn (409) nếu Code đã bị 1 hồ
// sơ ĐANG HOẠT ĐỘNG khác dùng lại kể từ lúc xóa (xem restoreTrashItem() ở lib/recordStore.js) — không
// tự động đổi mã bên nào, để admin tự xử lý.
//
// docs/contracts: khi mục được khôi phục thuộc 1 "họ" (phiên bản/phụ lục), TỰ ĐỘNG cố khôi phục luôn
// mọi thành viên còn lại của họ đó đang còn trong Thùng Rác (đối xứng với việc XOÁ đã cascade cả họ
// vào Thùng Rác cùng lúc) — trước đây phải tự khôi phục từng phiên bản 1, dễ bỏ sót và để tài liệu
// hiện ra với lịch sử phiên bản bị đứt quãng. restoredFamilyMembers/familyRestoreErrors: best-effort,
// không làm hỏng lượt khôi phục mục CHÍNH nếu 1 thành viên phụ không khôi phục được (xem
// restoreTrashItemWithFamily() ở lib/recordStore.js).
router.post('/:id/restore', async (req, res) => {
  const trashId = Number(req.params.id);
  if (!Number.isFinite(trashId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    assertAdmin(req.freshUser);
    const result = await restoreTrashItemWithFamily(trashId);
    res.json({
      ok: true, collection: result.collection, item: result.item,
      restoredFamilyMembers: result.restoredFamilyMembers,
      familyRestoreErrors: result.familyRestoreErrors
    });
  } catch (err) {
    handleError(res, `${trashId}/restore`, err);
  }
});

// DELETE /api/trash/:id — xóa vĩnh viễn, KHÔNG THỂ HOÀN TÁC. Bắt buộc "phiếu xác thực lại" giống hệt
// cơ chế duyệt (mật khẩu/OTP/PIN/vân tay tuỳ approverAuthLevel — xem routes/workflow.js
// APPROVAL_REAUTH_MODULES/consumeApprovalGrant() và withApprovalAuth() ở client) — khớp mức độ nghiêm
// trọng của 1 hành động không có đường lùi.
router.delete('/:id', async (req, res) => {
  const trashId = Number(req.params.id);
  if (!Number.isFinite(trashId)) return res.status(400).json({ error: 'id không hợp lệ' });
  try {
    assertAdmin(req.freshUser);
    const level = req.freshUser.perms?.approverAuthLevel || 'NONE';
    if (level !== 'NONE' && !(await consumeApprovalGrant(req.freshUser.username))) {
      return res.status(403).json({ error: 'Cần xác thực lại (mật khẩu/OTP/PIN/vân tay) trước khi xóa vĩnh viễn' });
    }
    await permanentlyDeleteTrashItem(trashId);
    res.json({ ok: true });
  } catch (err) {
    handleError(res, `${trashId}/delete`, err);
  }
});

module.exports = router;
