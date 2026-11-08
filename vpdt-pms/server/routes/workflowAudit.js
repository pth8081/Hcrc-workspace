// routes/workflowAudit.js — "🔍 Audit Quy Trình: Lỗ Hổng Phê Duyệt" (11/2026).
//
// Chỉ ADMIN mới gọi được (đúng gate đang áp dụng cho MỌI thao tác sửa "🔄 Quy Trình & Phê Duyệt" —
// isCurrentlyAdmin(), xem ADMIN_ONLY_KEYS ở routes/data.js) — hợp lý vì chỉ admin mới sửa được quy trình
// nên chỉ admin cần thấy audit của chính nó.
//
// 3 route:
//   GET  /api/admin/workflow-audit          — quét THẬT (chậm hơn, gọi khi bấm "🔄 Quét Ngay"), LUÔN ghi
//                                              đè cache tóm tắt (workflowAuditSummaryCache, dùng cho
//                                              route /summary bên dưới + job định kỳ so sánh thay đổi).
//   GET  /api/admin/workflow-audit/summary  — CHỈ đọc cache đã lưu (KHÔNG tự quét) — dùng cho thẻ cảnh
//                                              báo Dashboard (rẻ, không tính toán lại mỗi lần tải trang).
//   GET/POST /api/admin/workflow-audit/config — đọc/sửa {autoScanEmailEnabled, ccEmails[]}, job định kỳ
//                                              (jobs/workflowApproverGapAudit.js) đọc đúng key này.
//
// Cache/cấu hình lưu qua lib/appData.js (getAppDataValue/setAppDataValue) với 2 khoá RIÊNG, CỐ Ý KHÔNG
// thêm vào defaults.js/VALID_KEYS (routes/data.js) — findings chi tiết hé lộ cấu trúc phòng ban/quy
// trình nội bộ, không nên lẫn vào GET /api/data chung (key nào trong VALID_KEYS đều trả cho MỌI tài
// khoản đã đăng nhập đọc được, chỉ gác được lượt GHI qua ADMIN_ONLY_KEYS — xem chú thích đó). Tách hẳn
// route riêng + gate admin cho CẢ ĐỌC lẫn GHI mới đúng mức nhạy cảm của dữ liệu này.
'use strict';
const express = require('express');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { isCurrentlyAdmin } = require('../lib/adminAuth');
const { getAllAppData, getAppDataValue, setAppDataValue } = require('../lib/appData');
const { auditWorkflowApproverGaps } = require('../lib/workflowApproverAudit');
const { sendCatchError } = require('../lib/errorResponse');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

const SUMMARY_CACHE_KEY = 'workflowAuditSummaryCache';
const CONFIG_KEY = 'workflowAuditJobConfig';

async function requireAdmin(req, res) {
  const allowed = await isCurrentlyAdmin(req.user.username);
  if (!allowed) {
    res.status(403).json({ error: 'Chỉ Quản Trị Viên mới xem được Audit Quy Trình' });
    return false;
  }
  return true;
}

function summarize(findings) {
  return {
    total: findings.length,
    critical: findings.filter(f => f.severity === 'CRITICAL').length,
    warning: findings.filter(f => f.severity === 'WARNING').length
  };
}

router.get('/', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const appData = await getAllAppData();
    const findings = auditWorkflowApproverGaps(appData);
    const at = new Date().toISOString();
    await setAppDataValue(SUMMARY_CACHE_KEY, { at, ...summarize(findings) });
    res.json({ at, findings });
  } catch (err) { sendCatchError(res, err, 'Lỗi khi quét Audit Quy Trình'); }
});

router.get('/summary', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const cached = await getAppDataValue(SUMMARY_CACHE_KEY);
    res.json(cached || { at: null, total: 0, critical: 0, warning: 0 });
  } catch (err) { sendCatchError(res, err, 'Lỗi khi đọc tóm tắt Audit Quy Trình'); }
});

router.get('/config', async (req, res) => {
  try {
    if (!(await requireAdmin(req, res))) return;
    const cfg = await getAppDataValue(CONFIG_KEY);
    res.json(cfg || { autoScanEmailEnabled: true, ccEmails: [] });
  } catch (err) { sendCatchError(res, err, 'Lỗi khi đọc cấu hình Audit Quy Trình'); }
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
  } catch (err) { sendCatchError(res, err, 'Lỗi khi lưu cấu hình Audit Quy Trình'); }
});

module.exports = router;
