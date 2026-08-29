// routes/adminCatalog.js — Đổi tên (rename) 1 giá trị trong danh mục dạng danh sách phẳng CÓ cascade
// (stores/jobTitles/storeJobTitles) — tách riêng khỏi routes/data.js (nơi CHỈ ghi đè NGUYÊN cả mảng,
// không cascade gì) vì rename cần cập nhật ĐỒNG THỜI nhiều collection khác đang lưu nguyên chuỗi cũ (xem
// lib/catalogRename.js). Mount tại /api/admin, cạnh routes/adminExport.js.
const express = require('express');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { isCurrentlyAdmin } = require('../lib/adminAuth');
const { renameCatalogEntry } = require('../lib/catalogRename');
const { HttpError } = require('../lib/httpErrors');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

const VALID_CATALOG_KEYS = new Set(['stores', 'jobTitles', 'storeJobTitles']);

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
    res.json({ ok: true, catalog: updatedCatalog });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('POST /api/admin/renameCatalogEntry lỗi:', err.message);
    res.status(500).json({ error: 'Không thể đổi tên danh mục' });
  }
});

module.exports = router;
