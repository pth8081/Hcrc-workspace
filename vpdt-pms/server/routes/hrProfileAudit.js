// routes/hrProfileAudit.js — "🔍 Audit Nhân Sự" (11/2026). KHÁC 3 route audit trước (workflowAudit/
// userAudit/systemAudit — đều gác isCurrentlyAdmin(), chỉ admin xem được): route này sống TRONG module
// Nhân Sự, gác theo 2 lớp đúng khuôn mọi route Nhân Sự khác (xem routes/employeeProfile.js) — Khối 0
// (hasModuleAccessServer(user,'hrAudit')) VÀ quyền chi tiết (canFullViewProfiles/canManageContracts/
// hrReportView) — KHÔNG bắt buộc admin, đúng yêu cầu người dùng "nhân sự sẽ được phân quyền chứ admin
// không phân quyền đâu". admin vẫn luôn qua được (hasModuleAccessServer() tự bypass sẵn cho admin).
'use strict';
const express = require('express');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { hasModuleAccessServer } = require('../lib/recordViewScope');
const { getAllAppData, getAppDataValue, setAppDataValue } = require('../lib/appData');
const { canFullViewProfiles } = require('../lib/employeeProfile');
const { canManageContracts } = require('../lib/laborContract');
const { auditHrProfileGaps } = require('../lib/hrProfileAudit');
const { sendCatchError } = require('../lib/errorResponse');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

const SUMMARY_CACHE_KEY = 'hrProfileAuditSummaryCache';
const CONFIG_KEY = 'hrProfileAuditJobConfig';

function canAccessHrProfileAudit(user) {
  if (!hasModuleAccessServer(user, 'hrAudit')) return false;
  return !!(user?.perms?.admin || canFullViewProfiles(user) || canManageContracts(user) || user?.perms?.hrReportView);
}

function requireAccess(req, res) {
  if (!canAccessHrProfileAudit(req.freshUser)) {
    res.status(403).json({ error: 'Bạn không có quyền xem Audit Nhân Sự' });
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
    if (!requireAccess(req, res)) return;
    const appData = await getAllAppData();
    const config = await getAppDataValue(CONFIG_KEY);
    const findings = await auditHrProfileGaps(appData, config);
    const at = new Date().toISOString();
    await setAppDataValue(SUMMARY_CACHE_KEY, { at, ...summarize(findings) });
    res.json({ at, findings });
  } catch (err) { sendCatchError(res, err, 'Lỗi khi quét Audit Nhân Sự'); }
});

router.get('/summary', async (req, res) => {
  try {
    if (!requireAccess(req, res)) return;
    const cached = await getAppDataValue(SUMMARY_CACHE_KEY);
    res.json(cached || { at: null, total: 0, critical: 0, warning: 0, info: 0 });
  } catch (err) { sendCatchError(res, err, 'Lỗi khi đọc tóm tắt Audit Nhân Sự'); }
});

router.get('/config', async (req, res) => {
  try {
    if (!requireAccess(req, res)) return;
    const cfg = await getAppDataValue(CONFIG_KEY);
    res.json(cfg || { autoScanEmailEnabled: true, ccEmails: [], draftStaleDaysThreshold: 30, contractExpirySoonDays: 30 });
  } catch (err) { sendCatchError(res, err, 'Lỗi khi đọc cấu hình Audit Nhân Sự'); }
});

router.post('/config', async (req, res) => {
  try {
    if (!requireAccess(req, res)) return;
    const body = req.body || {};
    const autoScanEmailEnabled = body.autoScanEmailEnabled !== false;
    const ccEmails = Array.isArray(body.ccEmails)
      ? body.ccEmails.map(e => String(e || '').trim()).filter(Boolean).slice(0, 20)
      : [];
    const draftStaleDaysThreshold = Number(body.draftStaleDaysThreshold);
    const contractExpirySoonDays = Number(body.contractExpirySoonDays);
    const cfg = {
      autoScanEmailEnabled, ccEmails,
      draftStaleDaysThreshold: Number.isFinite(draftStaleDaysThreshold) && draftStaleDaysThreshold > 0
        ? Math.min(Math.round(draftStaleDaysThreshold), 3650) : 30,
      contractExpirySoonDays: Number.isFinite(contractExpirySoonDays) && contractExpirySoonDays > 0
        ? Math.min(Math.round(contractExpirySoonDays), 3650) : 30
    };
    await setAppDataValue(CONFIG_KEY, cfg);
    res.json(cfg);
  } catch (err) { sendCatchError(res, err, 'Lỗi khi lưu cấu hình Audit Nhân Sự'); }
});

module.exports = router;
