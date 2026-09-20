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
const { getTrashItems, getTrashItemCollection, restoreTrashItemWithFamily, permanentlyDeleteTrashItem } = require('../lib/recordStore');
const { consumeApprovalGrant } = require('../lib/approvalAuth');
const { insertSystemLog } = require('../lib/systemLogStore');

router.use(requireAuth, blockIfMustChangePassword);

function assertAdmin(user) {
  if (!user.perms?.admin) throw new HttpError(403, 'Chỉ Quản Trị Viên mới có quyền truy cập Thùng Rác');
}

// PHÁT HIỆN NGHIÊM TRỌNG (đợt audit chuyên sâu 12 cụm, 9/2026): assertAdmin() (chỉ cờ `admin`) từng là ĐỦ
// để xem/khôi phục/xoá vĩnh viễn TOÀN BỘ Thùng Rác, kể cả 5 collection cực nhạy cảm dưới đây — trong khi
// dữ liệu SỐNG của các collection này đã bị khoá theo ĐÚNG quyền chuyên biệt từ v23.28, KHÔNG còn admin tự
// bypass (xem canViewLaborContract() lib/recordViewScope.js:945, canViewFullProfile()
// lib/employeeProfile.js:380, canViewAllPayroll() lib/recordViewScope.js:1038). Một tài khoản chỉ có cờ
// `admin` (không có hrContractManage) xoá xong 1 HĐLĐ lại đọc được nguyên payload (lương cơ bản, lịch sử
// tăng lương ở amendments[]) qua GET /api/trash — bypass hoàn toàn luật đó, và restore còn trả nguyên item
// đó trong response. attendanceRecords CỐ Ý không có mặt trong map dưới đây — canViewAttendanceRecordsForUser()
// (lib/recordViewScope.js) bản thân đã cho phép `admin` xem (không thuộc nhóm "admin không tự bypass"
// như 4 collection còn lại), nên assertAdmin() ở trên là ĐỦ, giữ nguyên hành vi cũ cho collection này.
const SENSITIVE_TRASH_COLLECTION_CHECKS = {
  laborContracts: (user) => !!user.perms?.hrContractManage,
  employeeProfiles: (user) => !!(user.perms?.hrProfileManage || user.perms?.hrProfileFullView || user.perms?.hrProfileEdit),
  payslips: (user) => !!(user.perms?.hrPayrollManage || user.perms?.hrPayrollApprove),
  payrollPeriods: (user) => !!(user.perms?.hrPayrollManage || user.perms?.hrPayrollApprove)
};

// Gọi SAU assertAdmin() — chỉ xiết THÊM cho 5 collection nhạy cảm, các collection khác giữ nguyên
// admin-only như trước.
function assertSensitiveTrashCollectionAllowed(user, collection) {
  const check = SENSITIVE_TRASH_COLLECTION_CHECKS[collection];
  if (check && !check(user)) {
    throw new HttpError(403, 'Bạn không có quyền quản lý riêng của dữ liệu nhân sự này (hrContractManage/hrProfileManage/hrPayrollManage/hrAttendanceManage) nên không được thao tác với mục này trong Thùng Rác');
  }
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
    const collection = req.query.collection || null;
    if (collection) {
      assertSensitiveTrashCollectionAllowed(req.freshUser, collection);
      const items = await getTrashItems(collection);
      return res.json({ items });
    }
    // Không lọc theo 1 collection cụ thể -> liệt kê MỌI collection, nhưng phải TỰ LỌC BỚT các collection
    // nhạy cảm mà người gọi không đủ quyền chuyên biệt (xem SENSITIVE_TRASH_COLLECTION_CHECKS ở trên) —
    // không để lẫn vào danh sách chung "mọi collection".
    const items = await getTrashItems(null);
    const allowedItems = items.filter(it => {
      const check = SENSITIVE_TRASH_COLLECTION_CHECKS[it.collection];
      return !check || check(req.freshUser);
    });
    res.json({ items: allowedItems });
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
    const collection = await getTrashItemCollection(trashId);
    if (collection) assertSensitiveTrashCollectionAllowed(req.freshUser, collection);
    const result = await restoreTrashItemWithFamily(trashId);
    // LỖI ĐÃ VÁ (đợt audit chuyên sâu cụm "Hệ Thống/Admin/Cấu Hình", mức Thấp): khôi phục 1 hồ sơ từ
    // Thùng Rác KHÔNG để lại dấu vết nào ở Nhật ký hệ thống (client cũng không tự ghi) — 1 hồ sơ đã bị
    // xoá bỗng xuất hiện trở lại mà không ai truy được ai khôi phục, lúc nào. Ghi log SERVER-SIDE ngay
    // tại đây (fire-and-forget, không làm hỏng lượt khôi phục đã thành công nếu ghi log lỗi).
    insertSystemLog({
      username: req.freshUser?.username || req.user?.username, fullName: req.freshUser?.name || req.user?.username, ipAddress: req.ip,
      module: 'SYSTEM', actionType: 'TRASH_RESTORE',
      targetObject: `${result.collection}#${result.item?.id ?? trashId}`,
      description: `Khôi phục từ Thùng Rác: ${result.collection} [${result.item?.code || result.item?.title || result.item?.id || trashId}]`
        + (result.restoredFamilyMembers?.length ? ` (kèm ${result.restoredFamilyMembers.length} bản ghi cùng họ)` : '')
        + (result.familyRestoreErrors?.length ? ` — ${result.familyRestoreErrors.length} bản ghi cùng họ KHÔNG khôi phục được` : ''),
      status: result.familyRestoreErrors?.length ? 'WARNING' : 'SUCCESS'
    }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (khôi phục Thùng Rác):', e.message));
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
    const collection = await getTrashItemCollection(trashId);
    if (collection) assertSensitiveTrashCollectionAllowed(req.freshUser, collection);
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
