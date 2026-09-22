// routes/positionTypes.js — "Vị Trí Làm Việc" (10/2026, yêu cầu trực tiếp người dùng): danh mục MỞ thay
// cho 2 giá trị cứng "HO"/"STORE" (posType) trước đây. Mount tại /api/admin/position-types.
//
// KIẾN TRÚC: DB.positionTypes (AppData key mới, xem defaults.js) là 1 mảng {key,label,builtin,locations,
// jobTitles} — 2 mục "HO"/"STORE" (builtin:true) TIẾP TỤC dùng NGUYÊN hạ tầng cũ (DB.depts/DB.jobTitles
// cho HO, DB.stores/DB.storeJobTitles cho STORE — không có locations/jobTitles trong entry của chúng ở
// đây), quản lý qua đúng route CŨ (POST /api/admin/renameCatalogEntry, catalogKey 'depts'/'stores'/
// 'jobTitles'/'storeJobTitles'), KHÔNG đụng gì ở file này. Vị Trí Làm Việc MỚI (builtin:false) mang theo
// ĐÚNG 1 cặp danh mục con RIÊNG (locations[]/jobTitles[], chuỗi phẳng) nằm LỒNG trong chính entry đó.
//
// Thêm/xoá 1 "địa điểm"/"chức danh" bên trong 1 Vị Trí Làm Việc KHÔNG cần route riêng (client tự sửa
// mảng lồng trong DB.positionTypes rồi syncStorage('positionTypes') như mọi danh mục mảng phẳng đơn giản
// khác — KHÔNG cascade vì thêm/xoá không đụng dữ liệu đã có ở nơi khác, cùng khuôn add/deleteStore()).
// CHỈ đổi tên (rename) 1 giá trị đã có mới cần route riêng ở đây — vì rename phải cascade cập nhật mọi
// hồ sơ/user đang lưu nguyên chuỗi cũ (giống hệt lý do routes/adminCatalog.js tồn tại cho stores/depts/
// jobTitles/storeJobTitles).
//
// PHẠM VI GIAI ĐOẠN 1 (đã xác nhận với người dùng): route này chỉ phục vụ form Người Dùng/Import Excel/
// Vị Trí Kiêm Nhiệm — KHÔNG có validate/cascade cho Checklist tự đánh giá Siêu Thị, mô hình ca kíp
// Công&Phép/Lương, HR Onboarding, Cơ Cấu Tổ Chức, bộ duyệt hỗn hợp Vận Hành... (những tính năng đó hiện
// CHỈ nhận biết HO/STORE, xem VERSION.md đợt merge này).
const express = require('express');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { isCurrentlyAdmin } = require('../lib/adminAuth');
const { getAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { cascadeStoreRename, cascadeCustomPosTypeJobTitleRename } = require('../lib/catalogRename');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

const BUILTIN_KEYS = new Set(['HO', 'STORE']);
const MAX_LABEL_LEN = 60;
const MAX_ENTRY_LEN = 100;

async function requireAdmin(req) {
  const allowed = await isCurrentlyAdmin(req.user.username);
  if (!allowed) throw new HttpError(403, 'Chỉ Quản Trị Viên mới được quản lý Vị Trí Làm Việc');
}

// Sinh key ỔN ĐỊNH từ label (chữ hoa, bỏ dấu, chỉ giữ A-Z0-9_) — key là ĐỊNH DANH bất biến ghi vào
// user.posType, khác label (chỉ để HIỂN THỊ, đổi tự do qua PATCH /:key không cascade gì).
function slugifyKey(label) {
  const noDiacritics = String(label || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd');
  return noDiacritics.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
}

async function loadTypes() {
  return (await getAppDataValue('positionTypes')) || [];
}

router.get('/', async (req, res) => {
  try {
    res.json(await loadTypes());
  } catch (err) {
    sendCatchError(res, err, 'GET /api/admin/position-types');
  }
});

// POST / — body {label} — tạo 1 Vị Trí Làm Việc mới (builtin:false, locations/jobTitles rỗng).
router.post('/', async (req, res) => {
  try {
    await requireAdmin(req);
    const label = String(req.body?.label || '').trim().slice(0, MAX_LABEL_LEN);
    if (!label) return res.status(400).json({ error: 'Thiếu tên Vị Trí Làm Việc' });
    const key = slugifyKey(label);
    if (!key) return res.status(400).json({ error: 'Tên Vị Trí Làm Việc không hợp lệ (cần ít nhất 1 chữ/số)' });
    if (BUILTIN_KEYS.has(key)) return res.status(400).json({ error: `Tên "${label}" trùng định danh với Vị Trí có sẵn (HO/Siêu Thị)` });

    const updated = await withLockedAppDataValue('positionTypes', (list) => {
      const arr = Array.isArray(list) ? list : [];
      if (arr.some(t => t.key === key)) throw new HttpError(400, `Vị Trí Làm Việc "${label}" đã tồn tại`);
      return [...arr, { key, label, builtin: false, locations: [], jobTitles: [] }];
    });
    res.json({ ok: true, positionTypes: updated });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendCatchError(res, err, 'POST /api/admin/position-types');
  }
});

// PATCH /:key — body {label} — đổi NHÃN hiển thị (key giữ nguyên, không cascade gì vì không nơi nào
// khác lưu label, chỉ user.posType lưu key).
router.patch('/:key', async (req, res) => {
  try {
    await requireAdmin(req);
    const { key } = req.params;
    const label = String(req.body?.label || '').trim().slice(0, MAX_LABEL_LEN);
    if (!label) return res.status(400).json({ error: 'Thiếu tên mới' });
    const updated = await withLockedAppDataValue('positionTypes', (list) => {
      const arr = Array.isArray(list) ? list : [];
      const idx = arr.findIndex(t => t.key === key);
      if (idx === -1) throw new HttpError(404, `Không tìm thấy Vị Trí Làm Việc "${key}"`);
      const next = [...arr];
      next[idx] = { ...next[idx], label };
      return next;
    });
    res.json({ ok: true, positionTypes: updated });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendCatchError(res, err, 'PATCH /api/admin/position-types/:key');
  }
});

// DELETE /:key — chặn xoá 2 mục builtin (HO/STORE, không thể xoá — luôn phải có ít nhất 2 giá trị gốc)
// + chặn xoá nếu ĐANG có tài khoản dùng đúng Vị Trí này (khác confirmCatalogValueDeletion() ở client chỉ
// CẢNH BÁO cho 1 GIÁ TRỊ trong danh mục phẳng — xoá hẳn 1 Vị Trí Làm Việc kéo theo mất luôn cả nhánh
// locations/jobTitles con của nó, rủi ro cao hơn hẳn 1 giá trị đơn lẻ nên CHẶN CỨNG ở đây thay vì chỉ
// cảnh báo).
router.delete('/:key', async (req, res) => {
  try {
    await requireAdmin(req);
    const { key } = req.params;
    if (BUILTIN_KEYS.has(key)) return res.status(400).json({ error: 'Không thể xoá Vị Trí Làm Việc mặc định (HO/Siêu Thị)' });

    const users = (await getAppDataValue('users')) || [];
    const inUseCount = users.filter(u => u.posType === key).length;
    if (inUseCount > 0) {
      return res.status(400).json({ error: `Không thể xoá: đang có ${inUseCount} tài khoản gán Vị Trí Làm Việc này — đổi Vị Trí của họ trước khi xoá.` });
    }

    const updated = await withLockedAppDataValue('positionTypes', (list) => {
      const arr = Array.isArray(list) ? list : [];
      if (!arr.some(t => t.key === key)) throw new HttpError(404, `Không tìm thấy Vị Trí Làm Việc "${key}"`);
      return arr.filter(t => t.key !== key);
    });
    res.json({ ok: true, positionTypes: updated });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendCatchError(res, err, 'DELETE /api/admin/position-types/:key');
  }
});

function findCustomType(arr, key) {
  const t = (arr || []).find(x => x.key === key);
  if (!t) throw new HttpError(404, `Không tìm thấy Vị Trí Làm Việc "${key}"`);
  if (t.builtin) throw new HttpError(400, 'Vị Trí HO/Siêu Thị dùng danh mục Phòng Ban/Siêu Thị/Chức Danh riêng — sửa ở đúng màn đó, không sửa qua đây');
  return t;
}

// POST /:key/locations/rename — body {oldValue,newValue} — CÓ CASCADE (tái dùng cascadeStoreRename(),
// dept-field dùng CHUNG cho mọi Vị Trí nên hạ tầng cascade "just works" không cần lọc theo posType, xem
// chú thích cascadeStoreRename() ở lib/catalogRename.js).
router.post('/:key/locations/rename', async (req, res) => {
  try {
    await requireAdmin(req);
    const { key } = req.params;
    const oldValue = String(req.body?.oldValue || '').trim();
    const newValue = String(req.body?.newValue || '').trim().slice(0, MAX_ENTRY_LEN);
    if (!oldValue || !newValue) return res.status(400).json({ error: 'Thiếu giá trị cũ/mới cần đổi tên' });
    if (oldValue === newValue) return res.status(400).json({ error: 'Tên mới phải khác tên cũ' });

    const updated = await withLockedAppDataValue('positionTypes', (list) => {
      const arr = Array.isArray(list) ? list : [];
      const t = findCustomType(arr, key);
      const locations = Array.isArray(t.locations) ? t.locations : [];
      if (!locations.includes(oldValue)) throw new HttpError(404, `Không tìm thấy "${oldValue}" trong danh sách địa điểm của "${t.label}"`);
      if (locations.includes(newValue)) throw new HttpError(400, `"${newValue}" đã có trong danh sách địa điểm của "${t.label}"`);
      return arr.map(x => (x.key === key ? { ...x, locations: locations.map(v => (v === oldValue ? newValue : v)) } : x));
    });
    await cascadeStoreRename(oldValue, newValue);
    res.json({ ok: true, positionTypes: updated });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendCatchError(res, err, 'POST /api/admin/position-types/:key/locations/rename');
  }
});

// POST /:key/job-titles/rename — body {oldValue,newValue} — CÓ CASCADE (cascadeCustomPosTypeJobTitleRename()).
router.post('/:key/job-titles/rename', async (req, res) => {
  try {
    await requireAdmin(req);
    const { key } = req.params;
    const oldValue = String(req.body?.oldValue || '').trim();
    const newValue = String(req.body?.newValue || '').trim().slice(0, MAX_ENTRY_LEN);
    if (!oldValue || !newValue) return res.status(400).json({ error: 'Thiếu giá trị cũ/mới cần đổi tên' });
    if (oldValue === newValue) return res.status(400).json({ error: 'Tên mới phải khác tên cũ' });

    const updated = await withLockedAppDataValue('positionTypes', (list) => {
      const arr = Array.isArray(list) ? list : [];
      const t = findCustomType(arr, key);
      const jobTitles = Array.isArray(t.jobTitles) ? t.jobTitles : [];
      if (!jobTitles.includes(oldValue)) throw new HttpError(404, `Không tìm thấy "${oldValue}" trong danh sách chức danh của "${t.label}"`);
      if (jobTitles.includes(newValue)) throw new HttpError(400, `"${newValue}" đã có trong danh sách chức danh của "${t.label}"`);
      return arr.map(x => (x.key === key ? { ...x, jobTitles: jobTitles.map(v => (v === oldValue ? newValue : v)) } : x));
    });
    await cascadeCustomPosTypeJobTitleRename(key, oldValue, newValue);
    res.json({ ok: true, positionTypes: updated });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendCatchError(res, err, 'POST /api/admin/position-types/:key/job-titles/rename');
  }
});

module.exports = router;
