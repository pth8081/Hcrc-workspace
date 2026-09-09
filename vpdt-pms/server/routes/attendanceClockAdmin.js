// routes/attendanceClockAdmin.js — Quản lý (tạo/liệt kê/thu hồi) API key cấp RIÊNG cho máy chấm công
// vật lý/hệ thống trung gian đẩy dữ liệu chấm công qua POST /api/attendance/clock-punch (xem
// routes/attendanceClockPunch.js). Admin-only, mount tại /api/admin/attendance-clock-api-keys — mirror
// GẦN NHƯ Y HỆT routes/externalAuthAdmin.js (dùng chung lib/externalAuth.js cho phần sinh/hash/so khớp
// key + chặn IP theo dải) nhưng TÁCH RIÊNG collection (attendanceClockApiKeys, không phải
// externalApiKeys) — xem lib/attendance.js đầu file cho lý do tách (giảm phạm vi ảnh hưởng nếu 1 trong 2
// loại key bị lộ, máy chấm công vật lý thường đặt ở nơi công cộng hơn 1 tích hợp backend-to-backend).
const express = require('express');
const router = express.Router();
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { isCurrentlyAdmin } = require('../lib/adminAuth');
const { getAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { generateApiKey, keyDisplayPrefix, hashApiKey, parseAllowedIpsInput } = require('../lib/externalAuth');
const { insertSystemLog } = require('../lib/systemLogStore');
const { sendServerError } = require('../lib/errorResponse');

router.use(requireAuth, blockIfMustChangePassword);

function nextId(list) {
  const max = (list || []).reduce((m, k) => Math.max(m, Number(k.id) || 0), 0);
  return max + 1;
}

router.get('/', async (req, res) => {
  try {
    const allowed = await isCurrentlyAdmin(req.user.username);
    if (!allowed) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới được xem danh sách API key' });
    const list = (await getAppDataValue('attendanceClockApiKeys')) || [];
    res.json(list.map(({ keyHash, ...rest }) => rest));
  } catch (err) {
    sendServerError(res, 500, err, 'GET /api/admin/attendance-clock-api-keys', 'Không thể tải danh sách API key');
  }
});

router.post('/', async (req, res) => {
  try {
    const allowed = await isCurrentlyAdmin(req.user.username);
    if (!allowed) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới được tạo API key' });
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Vui lòng nhập tên/mô tả máy chấm công dùng key này' });

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
    await withLockedAppDataValue('attendanceClockApiKeys', (list) => {
      const current = Array.isArray(list) ? list : [];
      record.id = nextId(current);
      return [...current, record];
    });

    insertSystemLog({
      username: req.user.username, fullName: req.freshUser?.name || req.user.username, ipAddress: req.ip,
      module: 'ATTENDANCE_CLOCK', actionType: 'API_KEY_CREATED', targetObject: name,
      description: `Tạo API key máy chấm công mới "${name}" (id #${record.id}, prefix ${record.keyPrefix}…, ${allowedIps.length ? `giới hạn IP: ${allowedIps.join(', ')}` : 'không giới hạn IP'})`,
      status: 'SUCCESS'
    }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (tạo API key chấm công):', e.message));

    const { keyHash: _omit, ...safeRecord } = record;
    res.json({ ...safeRecord, apiKey: rawKey });
  } catch (err) {
    sendServerError(res, 500, err, 'POST /api/admin/attendance-clock-api-keys', 'Không thể tạo API key');
  }
});

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
    await withLockedAppDataValue('attendanceClockApiKeys', (list) => {
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
      module: 'ATTENDANCE_CLOCK', actionType: 'API_KEY_ALLOWED_IPS_UPDATED', targetObject: target?.name || `#${id}`,
      description: `Cập nhật danh sách IP cho phép của API key máy chấm công "${target?.name || ''}" (id #${id}): ${allowedIps.length ? allowedIps.join(', ') : 'không giới hạn IP'}`,
      status: 'SUCCESS'
    }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (sửa IP cho phép):', e.message));

    const { keyHash: _omit, ...safeRecord } = target;
    res.json(safeRecord);
  } catch (err) {
    if (err.message === 'NOT_FOUND') return res.status(404).json({ error: 'Không tìm thấy API key' });
    if (err.message === 'ALREADY_REVOKED') return res.status(409).json({ error: 'API key này đã bị thu hồi, không thể sửa' });
    sendServerError(res, 500, err, 'POST /api/admin/attendance-clock-api-keys/:id/allowed-ips', 'Không thể cập nhật danh sách IP cho phép');
  }
});

router.post('/:id/revoke', async (req, res) => {
  try {
    const allowed = await isCurrentlyAdmin(req.user.username);
    if (!allowed) return res.status(403).json({ error: 'Chỉ Quản Trị Viên mới được thu hồi API key' });
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id không hợp lệ' });

    let target = null;
    await withLockedAppDataValue('attendanceClockApiKeys', (list) => {
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
      module: 'ATTENDANCE_CLOCK', actionType: 'API_KEY_REVOKED', targetObject: target?.name || `#${id}`,
      description: `Thu hồi API key máy chấm công "${target?.name || ''}" (id #${id})`,
      status: 'SUCCESS'
    }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (thu hồi API key chấm công):', e.message));

    res.json({ ok: true });
  } catch (err) {
    if (err.message === 'NOT_FOUND') return res.status(404).json({ error: 'Không tìm thấy API key' });
    if (err.message === 'ALREADY_REVOKED') return res.status(409).json({ error: 'API key này đã bị thu hồi từ trước' });
    sendServerError(res, 500, err, 'POST /api/admin/attendance-clock-api-keys/:id/revoke', 'Không thể thu hồi API key');
  }
});

module.exports = router;
