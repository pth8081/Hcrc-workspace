// routes/systemAudit.js — "🔍 Audit Hệ Thống" (11/2026). Cùng khuôn routes/workflowAudit.js/
// routes/userAudit.js — gác isCurrentlyAdmin() cho CẢ đọc lẫn ghi. KHÁC 2 route kia: auditSystemHealthGaps()
// là ASYNC (đọc CSDL ErrorLogs + đĩa uploads/, không chỉ appData đã tải sẵn) nên route GET "/" có thể
// chậm hơn — chấp nhận được vì chỉ chạy khi bấm "Quét Ngay" hoặc job hằng ngày, không ở đường tải trang.
'use strict';
const express = require('express');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { isCurrentlyAdmin } = require('../lib/adminAuth');
const { getAppDataValue, setAppDataValue } = require('../lib/appData');
const { auditSystemHealthGaps } = require('../lib/systemHealthAudit');
const { sendCatchError } = require('../lib/errorResponse');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

const SUMMARY_CACHE_KEY = 'systemAuditSummaryCache';
const CONFIG_KEY = 'systemAuditJobConfig';

async function requireAdmin(req, res) {
  const allowed = await isCurrentlyAdmin(req.user.username);
  if (!allowed) {
    res.status(403).json({ error: 'Chỉ Quản Trị Viên mới xem được Audit Hệ Thống' });
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
    const findings = await auditSystemHealthGaps();
    const at = new Date().toISOString();
    await setAppDataValue(SUMMARY_CACHE_KEY, { at, ...summarize(findings) });
    res.json({ at, findings });
  } catch (err) { sendCatchError(res, err, 'Lỗi khi quét Audit Hệ Thống'); }
});

router.get('/summary', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const cached = await getAppDataValue(SUMMARY_CACHE_KEY);
    res.json(cached || { at: null, total: 0, critical: 0, warning: 0, info: 0 });
  } catch (err) { sendCatchError(res, err, 'Lỗi khi đọc tóm tắt Audit Hệ Thống'); }
});

router.get('/config', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const cfg = await getAppDataValue(CONFIG_KEY);
    res.json(cfg || { autoScanEmailEnabled: true, ccEmails: [] });
  } catch (err) { sendCatchError(res, err, 'Lỗi khi đọc cấu hình Audit Hệ Thống'); }
});

router.post('/config', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const body = req.body || {};
    const autoScanEmailEnabled = body.autoScanEmailEnabled !== false;
    const ccEmails = Array.isArray(body.ccEmails)
      ? body.ccEmails.map(e => String(e || '').trim()).filter(Boolean).slice(0, 20)
      : [];
    const cfg = { autoScanEmailEnabled, ccEmails };
    await setAppDataValue(CONFIG_KEY, cfg);
    res.json(cfg);
  } catch (err) { sendCatchError(res, err, 'Lỗi khi lưu cấu hình Audit Hệ Thống'); }
});

module.exports = router;
