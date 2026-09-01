// routes/externalAuthAdmin.js — Quản lý (tạo/liệt kê/thu hồi) API key cấp cho ứng dụng NGOÀI hệ thống,
// dùng để gọi POST /api/external/verify-credentials (routes/externalAuthVerify.js) xác thực tài khoản
// HCRC Workspace. Admin-only, mount tại /api/admin/external-api-keys — cạnh routes/adminCatalog.js.
const express = require('express');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { isCurrentlyAdmin } = require('../lib/adminAuth');
const { getAppDataValue, setAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { generateApiKey, keyDisplayPrefix, hashApiKey, parseAllowedIpsInput } = require('../lib/externalAuth');
const { insertSystemLog } = require('../lib/systemLogStore');
const { sendServerError } = require('../lib/errorResponse');

router.use(requireAuth, blockIfMustChangePassword);

function nextId(list) {
  const max = (list || []).reduce((m, k) => Math.max(m, Number(k.id) || 0), 0);
  return max + 1;
}

// externalApiKeys được seed sẵn ([]) trong defaults.js/seedDefaults.js nên dòng AppData luôn tồn tại
// từ lúc khởi động — withLockedAppDataValue() có thể gọi thẳng không cần bước "tạo trước nếu thiếu"
// như 1 số collection admin-config khác trong hệ thống.

// GET /api/admin/external-api-keys — danh sách (KHÔNG kèm keyHash, xem lib/externalAuth.js/routes/data.js
// sanitizeExternalApiKeys() cùng nguyên tắc, ở đây tự strip lại vì route riêng không đi qua routes/data.js).
router.get('/', async (req, res) => {
  try {
    const allowed = await isCurrentlyAdmin(req.user.username);
    if (!allowed) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới được xem danh sách API key' });
    const list = (await getAppDataValue('externalApiKeys')) || [];
    res.json(list.map(({ keyHash, ...rest }) => rest));
  } catch (err) {
    sendServerError(res, 500, err, 'GET /api/admin/external-api-keys', 'Không thể tải danh sách API key');
  }
});

// POST /api/admin/external-api-keys — tạo key mới. Body { name, allowedIps }. Trả về "apiKey" (giá trị
// THẬT) ĐÚNG 1 LẦN duy nhất ở response này — sau đó DB chỉ còn giữ bcrypt hash, không có cách nào lấy
// lại được nữa (mất thì phải thu hồi + tạo key mới, không có API "xem lại").
//
// allowedIps (lớp bảo mật thứ 2, TUỲ CHỌN): chuỗi thô (1 IP/dải CIDR mỗi dòng hoặc phân tách dấu phẩy)
// hoặc mảng chuỗi có sẵn — xem parseAllowedIpsInput()/isIpAllowed() ở lib/externalAuth.js. Để trống =
// KHÔNG hạn chế, cho phép gọi từ bất kỳ IP nào (chỉ cần đúng key) — giữ hành vi mặc định đơn giản cho
// tích hợp không có IP tĩnh.
router.post('/', async (req, res) => {
  try {
    const allowed = await isCurrentlyAdmin(req.user.username);
    if (!allowed) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới được tạo API key' });
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Vui lòng nhập tên/mô tả ứng dụng dùng key này' });

    let allowedIps;
    try {
      const rawAllowedIps = req.body?.allowedIps;
      allowedIps = Array.isArray(rawAllowedIps) ? rawAllowedIps : parseAllowedIpsInput(rawAllowedIps);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const rawKey = generateApiKey();
    const keyHash = await hashApiKey(rawKey);
    const record = {
      id: null, name, keyPrefix: keyDisplayPrefix(rawKey), keyHash,
      allowedIps,
      active: true,
      createdBy: req.user.username, createdByName: req.freshUser?.name || req.user.username,
      createdAt: new Date().toISOString(),
      revokedBy: null, revokedByName: null, revokedAt: null,
      lastUsedAt: null
    };
    await withLockedAppDataValue('externalApiKeys', (list) => {
      const current = Array.isArray(list) ? list : [];
      record.id = nextId(current);
      return [...current, record];
    });

    insertSystemLog({
      username: req.user.username, fullName: req.freshUser?.name || req.user.username, ipAddress: req.ip,
      module: 'EXTERNAL_AUTH', actionType: 'API_KEY_CREATED', targetObject: name,
      description: `Tạo API key mới cho ứng dụng ngoài "${name}" (id #${record.id}, prefix ${record.keyPrefix}…, ${allowedIps.length ? `giới hạn IP: ${allowedIps.join(', ')}` : 'không giới hạn IP'})`,
      status: 'SUCCESS'
    }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (tạo API key):', e.message));

    const { keyHash: _omit, ...safeRecord } = record;
    res.json({ ...safeRecord, apiKey: rawKey });
  } catch (err) {
    sendServerError(res, 500, err, 'POST /api/admin/external-api-keys', 'Không thể tạo API key');
  }
});

// POST /api/admin/external-api-keys/:id/allowed-ips — sửa danh sách IP cho phép của 1 key ĐANG hoạt
// động (không sửa được key đã thu hồi — thu hồi là trạng thái cuối). Body { allowedIps } cùng định dạng
// như lúc tạo (chuỗi thô hoặc mảng); gửi rỗng = bỏ hạn chế, cho phép lại mọi IP.
router.post('/:id/allowed-ips', async (req, res) => {
  try {
    const allowed = await isCurrentlyAdmin(req.user.username);
    if (!allowed) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới được sửa danh sách IP cho phép' });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });

    let allowedIps;
    try {
      const rawAllowedIps = req.body?.allowedIps;
      allowedIps = Array.isArray(rawAllowedIps) ? rawAllowedIps : parseAllowedIpsInput(rawAllowedIps);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    let target = null;
    await withLockedAppDataValue('externalApiKeys', (list) => {
      const current = Array.isArray(list) ? list : [];
      const idx = current.findIndex(k => k.id === id);
      if (idx === -1) throw new Error('NOT_FOUND');
      if (current[idx].active === false) throw new Error('ALREADY_REVOKED');
      const updated = [...current];
      updated[idx] = { ...current[idx], allowedIps };
      target = updated[idx];
      return updated;
    });

    insertSystemLog({
      username: req.user.username, fullName: req.freshUser?.name || req.user.username, ipAddress: req.ip,
      module: 'EXTERNAL_AUTH', actionType: 'API_KEY_ALLOWED_IPS_UPDATED', targetObject: target?.name || `#${id}`,
      description: `Cập nhật danh sách IP cho phép của API key "${target?.name || ''}" (id #${id}): ${allowedIps.length ? allowedIps.join(', ') : 'không giới hạn IP'}`,
      status: 'SUCCESS'
    }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (sửa IP cho phép):', e.message));

    const { keyHash: _omit, ...safeRecord } = target;
    res.json(safeRecord);
  } catch (err) {
    if (err.message === 'NOT_FOUND') return res.status(404).json({ error: 'Không tìm thấy API key' });
    if (err.message === 'ALREADY_REVOKED') return res.status(409).json({ error: 'API key này đã bị thu hồi, không thể sửa' });
    sendServerError(res, 500, err, 'POST /api/admin/external-api-keys/:id/allowed-ips', 'Không thể cập nhật danh sách IP cho phép');
  }
});

// POST /api/admin/external-api-keys/:id/revoke — thu hồi vĩnh viễn (không có "kích hoạt lại", phải tạo
// key mới nếu cần tiếp tục dùng — khớp mô hình "vô hiệu hoá" chứ không phải "tạm ẩn").
router.post('/:id/revoke', async (req, res) => {
  try {
    const allowed = await isCurrentlyAdmin(req.user.username);
    if (!allowed) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới được thu hồi API key' });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });

    let target = null;
    await withLockedAppDataValue('externalApiKeys', (list) => {
      const current = Array.isArray(list) ? list : [];
      const idx = current.findIndex(k => k.id === id);
      if (idx === -1) throw new Error('NOT_FOUND');
      if (current[idx].active === false) throw new Error('ALREADY_REVOKED');
      target = current[idx];
      const updated = [...current];
      updated[idx] = {
        ...current[idx], active: false,
        revokedBy: req.user.username, revokedByName: req.freshUser?.name || req.user.username,
        revokedAt: new Date().toISOString()
      };
      return updated;
    });

    insertSystemLog({
      username: req.user.username, fullName: req.freshUser?.name || req.user.username, ipAddress: req.ip,
      module: 'EXTERNAL_AUTH', actionType: 'API_KEY_REVOKED', targetObject: target?.name || `#${id}`,
      description: `Thu hồi API key "${target?.name || ''}" (id #${id})`,
      status: 'SUCCESS'
    }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (thu hồi API key):', e.message));

    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'NOT_FOUND') return res.status(404).json({ error: 'Không tìm thấy API key' });
    if (err.message === 'ALREADY_REVOKED') return res.status(409).json({ error: 'API key này đã bị thu hồi từ trước' });
    sendServerError(res, 500, err, 'POST /api/admin/external-api-keys/:id/revoke', 'Không thể thu hồi API key');
  }
});

module.exports = router;
