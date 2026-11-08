// routes/userAudit.js — "🔍 Audit Người Dùng" (11/2026). Cùng khuôn routes/workflowAudit.js (đọc chú
// thích đầy đủ ở đó) — gác isCurrentlyAdmin() cho CẢ đọc lẫn ghi, cache/config lưu qua AppData với 2
// khoá RIÊNG, CỐ Ý KHÔNG thêm vào defaults.js/VALID_KEYS (routes/data.js) vì chi tiết tài khoản/quyền
// admin nhạy cảm hơn mức mọi tài khoản đã đăng nhập nên biết.
'use strict';
const express = require('express');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { isCurrentlyAdmin } = require('../lib/adminAuth');
const { getAllAppData, getAppDataValue, setAppDataValue } = require('../lib/appData');
const { auditUserAccountGaps } = require('../lib/userAccountAudit');
const { sendCatchError } = require('../lib/errorResponse');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

const SUMMARY_CACHE_KEY = 'userAuditSummaryCache';
const CONFIG_KEY = 'userAuditJobConfig';

async function requireAdmin(req, res) {
  const allowed = await isCurrentlyAdmin(req.user.username);
  if (!allowed) {
    res.status(403).json({ error: 'Chỉ Quản Trị Viên mới xem được Audit Người Dùng' });
    return false;
  }
  return true;
}

function summarize(findings) {
  return {
    total: findings.length,
    critical: findings.filter(f => f.severity === 'CRITICAL').length,
    warning: findings.filter(f => f.severity === 'WARNING').length,
    info: findings.filter(f => f.severity === 'INFO').length
  };
}

router.get('/', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const appData = await getAllAppData();
    const config = await getAppDataValue(CONFIG_KEY);
    const findings = auditUserAccountGaps(appData, config);
    const at = new Date().toISOString();
    await setAppDataValue(SUMMARY_CACHE_KEY, { at, ...summarize(findings) });
    res.json({ at, findings });
  } catch (err) { sendCatchError(res, err, 'Lỗi khi quét Audit Người Dùng'); }
});

router.get('/summary', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const cached = await getAppDataValue(SUMMARY_CACHE_KEY);
    res.json(cached || { at: null, total: 0, critical: 0, warning: 0, info: 0 });
  } catch (err) { sendCatchError(res, err, 'Lỗi khi đọc tóm tắt Audit Người Dùng'); }
});

router.get('/config', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const cfg = await getAppDataValue(CONFIG_KEY);
    res.json(cfg || { autoScanEmailEnabled: true, ccEmails: [], dormantDaysThreshold: 90 });
  } catch (err) { sendCatchError(res, err, 'Lỗi khi đọc cấu hình Audit Người Dùng'); }
});

router.post('/config', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const body = req.body || {};
    const autoScanEmailEnabled = body.autoScanEmailEnabled !== false;
    const ccEmails = Array.isArray(body.ccEmails)
      ? body.ccEmails.map(e => String(e || '').trim()).filter(Boolean).slice(0, 20)
      : [];
    const dormantDaysThreshold = Number(body.dormantDaysThreshold);
    const cfg = {
      autoScanEmailEnabled, ccEmails,
      dormantDaysThreshold: Number.isFinite(dormantDaysThreshold) && dormantDaysThreshold > 0
        ? Math.min(Math.round(dormantDaysThreshold), 3650) : 90
    };
    await setAppDataValue(CONFIG_KEY, cfg);
    res.json(cfg);
  } catch (err) { sendCatchError(res, err, 'Lỗi khi lưu cấu hình Audit Người Dùng'); }
});

module.exports = router;
