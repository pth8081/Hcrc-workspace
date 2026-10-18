// routes/adminCatalog.js — Đổi tên (rename) 1 giá trị trong danh mục dạng danh sách phẳng CÓ cascade
// (stores/jobTitles/storeJobTitles) — tách riêng khỏi routes/data.js (nơi CHỈ ghi đè NGUYÊN cả mảng,
// không cascade gì) vì rename cần cập nhật ĐỒNG THỜI nhiều collection khác đang lưu nguyên chuỗi cũ (xem
// lib/catalogRename.js). Mount tại /api/admin, cạnh routes/adminExport.js.
const express = require('express');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { isCurrentlyAdmin } = require('../lib/adminAuth');
const { renameCatalogEntry } = require('../lib/catalogRename');
const { HttpError } = require('../lib/httpErrors');
const { insertSystemLog } = require('../lib/systemLogStore');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

// BUG THẬT đã sửa (rà soát theo yêu cầu người dùng "trong danh mục bạn xử lý cho tất cả các danh mục
// đều phải sửa được thay vì phải xóa tạo lại như bây giờ"): mở rộng từ 3 lên 7 khoá — 2 khoá mới CÓ
// cascade riêng (depts/cats, xem lib/catalogRename.js CATALOG_HANDLERS) + 4 khoá mới KHÔNG cần cascade
// (licenseTypes/carTaxiCompanies/priceZones/trainingCategories — dùng simpleArrayCatalogHandler()).
// 'contractTypes' — THÊM ở đợt rà soát chuyên sâu vòng 2 (cụm "…/Hợp Đồng/…", mức Thấp — "đổi tên Loại
// Pháp Lý HĐ không cascade contractTypeAbbrs/contracts.type"): CÓ cascade riêng (cascadeContractTypeRename(),
// xem lib/catalogRename.js), cùng khuôn depts/cats.
const VALID_CATALOG_KEYS = new Set([
  'stores', 'jobTitles', 'storeJobTitles', 'depts', 'cats', 'contractTypes',
  'licenseTypes', 'carTaxiCompanies', 'priceZones', 'trainingCategories',
  'itRenewalCategories', 'carEvaluationIssues',
  // 7 danh mục gợi ý (10/2026, rà soát "mọi danh mục đều phải có Sửa") — xem CATALOG_HANDLERS ở
  // lib/catalogRename.js (simpleArrayCatalogHandler, không cascade).
  'jobGrades', 'resignationReasons', 'disciplinaryTypes', 'legalEntities',
  'specialLaborStatuses', 'currentWorkStatusDetails', 'nationalIdIssuePlaces',
  // educationDegrees (10/2026, báo cáo rà soát mẫu Excel mới) — cùng khuôn 7 danh mục gợi ý ngay trên.
  'educationDegrees',
  // relationshipTypes/nationalities/contractAmendmentTypes/contractTerminationReasons (11/2026, rà soát
  // "trường có nút select nhưng đang để nhập tay") — cùng khuôn simpleArrayCatalogHandler, không cascade.
  'relationshipTypes', 'nationalities', 'contractAmendmentTypes', 'contractTerminationReasons',
  // maritalStatuses (11/2026, "đưa luôn Tình trạng hôn nhân vào danh mục") — cùng khuôn ngay trên.
  'maritalStatuses'
]);

// POST /api/admin/renameCatalogEntry — body { catalogKey, oldValue, newValue }. Chỉ Quản Trị Viên (khớp
// đúng gate của mọi route admin khác — xem isCurrentlyAdmin() ở lib/adminAuth.js).
router.post('/renameCatalogEntry', async (req, res) => {
  try {
    const allowed = await isCurrentlyAdmin(req.user.username);
    if (!allowed) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới có quyền sửa danh mục này' });

    const { catalogKey, oldValue, newValue } = req.body || {};
    if (!VALID_CATALOG_KEYS.has(catalogKey)) {
      return res.status(400).json({ error: `Danh mục không hợp lệ: ${catalogKey}` });
    }
    const trimmedOld = typeof oldValue === 'string' ? oldValue.trim() : '';
    const trimmedNew = typeof newValue === 'string' ? newValue.trim() : '';
    if (!trimmedOld || !trimmedNew) {
      return res.status(400).json({ error: 'Thiếu giá trị cũ/mới cần đổi tên' });
    }
    if (trimmedOld === trimmedNew) {
      return res.status(400).json({ error: 'Tên mới phải khác tên cũ' });
    }

    const updatedCatalog = await renameCatalogEntry(catalogKey, trimmedOld, trimmedNew);

    // LỖI ĐÃ VÁ (re-audit lần 4, mức TB): đổi tên 1 giá trị danh mục CÓ cascade sang hàng loạt collection
    // khác (xem lib/catalogRename.js) nhưng KHÔNG để lại dấu vết nào ở Nhật ký hệ thống — khác hẳn thao
    // tác ghi đè cả collection qua POST /api/data/:key (đã ghi log qua logAdminSensitiveDataWrite() ở
    // routes/data.js). Ghi log server-side NGAY tại đây, fire-and-forget, cùng khuôn insertSystemLog() ở
    // routes/trash.js/routes/attendanceClockAdmin.js — lỗi ghi log không làm hỏng lượt đổi tên đã thành công.
    insertSystemLog({
      username: req.freshUser?.username || req.user?.username, fullName: req.freshUser?.name || req.user?.username, ipAddress: req.ip,
      module: 'CONFIG', actionType: 'CATALOG_RENAME', targetObject: catalogKey,
      description: `Đổi tên danh mục "${catalogKey}": "${trimmedOld}" → "${trimmedNew}"`,
      status: 'SUCCESS'
    }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (đổi tên danh mục):', e.message));

    res.json({ ok: true, catalog: updatedCatalog });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/admin/renameCatalogEntry lỗi:', err.message);
    res.status(500).json({ error: 'Không thể đổi tên danh mục' });
  }
});

module.exports = router;
