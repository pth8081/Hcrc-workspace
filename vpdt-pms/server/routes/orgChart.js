// routes/orgChart.js — Cơ Cấu Tổ Chức v2 (cây có versioning) + Cấu Hình Luồng Đánh Giá KPI Theo Vị
// Trí. Toàn bộ dữ liệu 1 khoá AppData "orgChartVersions" (mảng version — xem lib/orgChart.js đầu file
// đó để biết lý do KHÔNG dùng dbo.Records/PositionAssignments-có-lịch-sử như tài liệu thiết kế gốc).
//
// Quyền: XEM (mọi GET) mở cho orgChartManage/nhanSuManage/kpiFlowConfigManage/admin — cùng độ mở
// canAccessOrgChartModule() bản cũ (public/js/core.js) mở rộng thêm kpiFlowConfigManage (quyền MỚI,
// tách riêng theo khuyến nghị tài liệu — 1 người có thể chỉ được giao tinh chỉnh luồng KPI mà không
// được sửa cây tổ chức). SỬA CÂY (node/version lifecycle) chỉ orgChartManage/admin. SỬA LUỒNG KPI
// (thêm/bớt quan hệ đánh giá) orgChartManage/kpiFlowConfigManage/admin.
const express = require('express');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { getAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { HttpError } = require('../lib/httpErrors');
const { sendServerError, sendCatchError } = require('../lib/errorResponse');
const orgChart = require('../lib/orgChart');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

function canView(perms) {
  return !!(perms?.admin || perms?.orgChartManage || perms?.nhanSuManage || perms?.kpiFlowConfigManage);
}
function canManageTree(perms) {
  return !!(perms?.admin || perms?.orgChartManage);
}
function canManageKpiFlow(perms) {
  return !!(perms?.admin || perms?.orgChartManage || perms?.kpiFlowConfigManage);
}
function requireView(req, res) {
  if (!canView(req.freshUser.perms)) { res.status(403).json({ error: 'Bạn không có quyền xem Cơ Cấu Tổ Chức' }); return false; }
  return true;
}
function requireManageTree(req, res) {
  if (!canManageTree(req.freshUser.perms)) { res.status(403).json({ error: 'Chỉ người có quyền Quản Lý Cơ Cấu Tổ Chức mới thao tác được' }); return false; }
  return true;
}
function requireManageKpiFlow(req, res) {
  if (!canManageKpiFlow(req.freshUser.perms)) { res.status(403).json({ error: 'Chỉ người có quyền Quản Lý Cơ Cấu Tổ Chức/Cấu Hình KPI mới thao tác được' }); return false; }
  return true;
}
function stripHeavy(v) {
  return { id: v.id, versionName: v.versionName, status: v.status, effectiveDate: v.effectiveDate, clonedFromVersionId: v.clonedFromVersionId, createdBy: v.createdBy, createdAt: v.createdAt, appliedBy: v.appliedBy, appliedAt: v.appliedAt, nodeCount: (v.nodes || []).length };
}

// GET /api/org-chart/versions — danh sách nhẹ (không kèm nodes/kpiFlow).
router.get('/versions', async (req, res) => {
  if (!requireView(req, res)) return;
  try {
    const list = (await getAppDataValue('orgChartVersions')) || [];
    res.json({ versions: list.map(stripHeavy).sort((a, b) => b.id - a.id) });
  } catch (err) { sendCatchError(res, err, 'GET /api/org-chart/versions'); }
});

// GET /api/org-chart/versions/:id — đầy đủ (nodes + kpiFlow).
router.get('/versions/:id', async (req, res) => {
  if (!requireView(req, res)) return;
  try {
    const list = (await getAppDataValue('orgChartVersions')) || [];
    const version = orgChart.findVersion(list, Number(req.params.id));
    if (!version) return res.status(404).json({ error: 'Không tìm thấy phiên bản' });
    res.json({ version });
  } catch (err) { sendCatchError(res, err, 'GET /api/org-chart/versions/:id'); }
});

// POST /api/org-chart/bootstrap — khởi tạo version ĐẦU TIÊN (chỉ khi chưa có version nào).
router.post('/bootstrap', async (req, res) => {
  if (!requireManageTree(req, res)) return;
  try {
    const result = await withLockedAppDataValue('orgChartVersions', (list) => {
      const version = orgChart.bootstrapFirstVersion(list, req.body?.versionName, req.freshUser.username);
      return [...(list || []), version];
    });
    res.json({ ok: true, version: result[result.length - 1] });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, 'POST /api/org-chart/bootstrap', 'Không thể khởi tạo cơ cấu tổ chức');
  }
});

// POST /api/org-chart/versions/:id/clone — tạo bản nháp mới từ 1 version có sẵn (thường là APPLIED).
router.post('/versions/:id/clone', async (req, res) => {
  if (!requireManageTree(req, res)) return;
  try {
    let created;
    const result = await withLockedAppDataValue('orgChartVersions', (list) => {
      created = orgChart.cloneVersion(list, Number(req.params.id), req.body?.versionName, req.freshUser.username);
      return [...list, created];
    });
    res.json({ ok: true, version: created });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, 'POST /api/org-chart/versions/:id/clone', 'Không thể tạo bản nháp');
  }
});

// PATCH /api/org-chart/versions/:id — đổi tên version (chỉ DRAFT).
router.patch('/versions/:id', async (req, res) => {
  if (!requireManageTree(req, res)) return;
  try {
    let updated;
    await withLockedAppDataValue('orgChartVersions', (list) => {
      const version = orgChart.requireVersion(list, Number(req.params.id));
      orgChart.requireDraft(version);
      if (!req.body?.versionName || !req.body.versionName.trim()) throw new HttpError(400, 'Tên phiên bản không được để trống');
      version.versionName = req.body.versionName.trim();
      updated = version;
      return list;
    });
    res.json({ ok: true, version: updated });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, 'PATCH /api/org-chart/versions/:id', 'Không thể đổi tên phiên bản');
  }
});

// POST /api/org-chart/versions/:id/nodes — thêm node (Phòng Ban / Vị Trí).
router.post('/versions/:id/nodes', async (req, res) => {
  if (!requireManageTree(req, res)) return;
  try {
    let created;
    await withLockedAppDataValue('orgChartVersions', (list) => {
      const version = orgChart.requireVersion(list, Number(req.params.id));
      created = orgChart.addNode(version, req.body || {});
      return list;
    });
    res.json({ ok: true, node: created });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, 'POST /api/org-chart/versions/:id/nodes', 'Không thể thêm node');
  }
});

// PATCH /api/org-chart/versions/:id/nodes/:nodeId — sửa node.
router.patch('/versions/:id/nodes/:nodeId', async (req, res) => {
  if (!requireManageTree(req, res)) return;
  try {
    let updated;
    await withLockedAppDataValue('orgChartVersions', (list) => {
      const version = orgChart.requireVersion(list, Number(req.params.id));
      updated = orgChart.editNode(version, Number(req.params.nodeId), req.body || {});
      return list;
    });
    res.json({ ok: true, node: updated });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, 'PATCH /api/org-chart/versions/:id/nodes/:nodeId', 'Không thể sửa node');
  }
});

// DELETE /api/org-chart/versions/:id/nodes/:nodeId — xoá node + nhánh con (chặn nếu còn người giữ).
router.delete('/versions/:id/nodes/:nodeId', async (req, res) => {
  if (!requireManageTree(req, res)) return;
  try {
    const users = (await getAppDataValue('users')) || [];
    let deletedIds;
    await withLockedAppDataValue('orgChartVersions', (list) => {
      const version = orgChart.requireVersion(list, Number(req.params.id));
      deletedIds = orgChart.deleteNodeCascade(version, Number(req.params.nodeId), users);
      return list;
    });
    res.json({ ok: true, deletedNodeIds: deletedIds });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, 'DELETE /api/org-chart/versions/:id/nodes/:nodeId', 'Không thể xoá node');
  }
});

// POST /api/org-chart/versions/:id/validate — kiểm tra hợp lệ trước khi áp dụng (không ghi gì).
router.post('/versions/:id/validate', async (req, res) => {
  if (!requireManageTree(req, res)) return;
  try {
    const list = (await getAppDataValue('orgChartVersions')) || [];
    const version = orgChart.requireVersion(list, Number(req.params.id));
    const applied = orgChart.getAppliedVersion(list);
    const users = (await getAppDataValue('users')) || [];
    const issues = orgChart.computeValidationIssues(version, applied, users);
    res.json({ valid: issues.length === 0, issues });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, 'POST /api/org-chart/versions/:id/validate', 'Không thể kiểm tra');
  }
});

// POST /api/org-chart/versions/:id/apply — áp dụng version (2 bước khoá riêng: orgChartVersions rồi
// users — xem giải thích ở lib/orgChart.js applyVersionInPlace()/computeManagerUsernameUpdates()).
router.post('/versions/:id/apply', async (req, res) => {
  if (!requireManageTree(req, res)) return;
  let appliedVersion;
  try {
    const usersSnapshot = (await getAppDataValue('users')) || []; // chỉ để validate — bước ghi managerUsername thật ở dưới tự đọc lại bản mới nhất trong khoá riêng
    await withLockedAppDataValue('orgChartVersions', (list) => {
      appliedVersion = orgChart.applyVersionInPlace(list, Number(req.params.id), usersSnapshot, req.freshUser.username);
      return list;
    });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    return sendServerError(res, 500, err, 'POST /api/org-chart/versions/:id/apply', 'Không thể áp dụng phiên bản');
  }
  let unresolved = [];
  try {
    await withLockedAppDataValue('users', (currentUsers) => {
      const { changes, unresolved: u } = orgChart.computeManagerUsernameUpdates(appliedVersion, currentUsers);
      unresolved = u;
      return orgChart.applyManagerUsernameUpdates(currentUsers, changes);
    });
  } catch (err) {
    console.error('⛔ Áp dụng cơ cấu tổ chức thành công nhưng lỗi khi tự cập nhật Quản Lý Trực Tiếp:', err.message);
    unresolved = [{ username: '', name: '', reason: 'Lỗi hệ thống khi tự cập nhật Quản Lý Trực Tiếp — vui lòng kiểm tra thủ công' }];
  }
  res.json({ ok: true, version: appliedVersion, unresolvedManagerUsers: unresolved });
});

// GET /api/org-chart/kpi-flow — luồng đánh giá KPI của version đang APPLIED (kèm tên hiển thị + người
// hiện đang giữ mỗi vị trí, để client vẽ ngay không cần tính lại).
router.get('/kpi-flow', async (req, res) => {
  if (!requireView(req, res)) return;
  try {
    const list = (await getAppDataValue('orgChartVersions')) || [];
    const applied = orgChart.getAppliedVersion(list);
    if (!applied) return res.json({ version: null, rows: [] });
    const users = (await getAppDataValue('users')) || [];
    const byId = new Map((applied.nodes || []).map(n => [n.nodeId, n]));
    const rows = (applied.kpiFlow || []).map(f => {
      const evaluator = byId.get(f.evaluatorNodeId);
      const evaluatee = byId.get(f.evaluateeNodeId);
      return {
        id: f.id, isAutoFromHierarchy: f.isAutoFromHierarchy,
        evaluatorNodeId: f.evaluatorNodeId, evaluateeNodeId: f.evaluateeNodeId,
        evaluatorName: evaluator ? orgChart.buildNodeDisplayName(applied, evaluator) : '',
        evaluateeName: evaluatee ? orgChart.buildNodeDisplayName(applied, evaluatee) : '',
        evaluatorOccupants: evaluator ? orgChart.resolvePositionOccupants(applied, evaluator, users) : [],
        evaluateeOccupants: evaluatee ? orgChart.resolvePositionOccupants(applied, evaluatee, users) : []
      };
    });
    res.json({ version: stripHeavy(applied), rows });
  } catch (err) { sendCatchError(res, err, 'GET /api/org-chart/kpi-flow'); }
});

// POST /api/org-chart/kpi-flow — thêm 1 quan hệ đánh giá thủ công (chéo/ma trận/bỏ cấp).
router.post('/kpi-flow', async (req, res) => {
  if (!requireManageKpiFlow(req, res)) return;
  try {
    let row;
    await withLockedAppDataValue('orgChartVersions', (list) => {
      const applied = orgChart.getAppliedVersion(list);
      if (!applied) throw new HttpError(400, 'Chưa có phiên bản cơ cấu tổ chức nào đang áp dụng');
      row = orgChart.addKpiFlowRow(applied, Number(req.body?.evaluatorNodeId), Number(req.body?.evaluateeNodeId), req.freshUser.username);
      return list;
    });
    res.json({ ok: true, row });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, 'POST /api/org-chart/kpi-flow', 'Không thể thêm quan hệ đánh giá');
  }
});

// DELETE /api/org-chart/kpi-flow/:rowId — gỡ 1 quan hệ (kể cả quan hệ tự động suy ra từ cây).
router.delete('/kpi-flow/:rowId', async (req, res) => {
  if (!requireManageKpiFlow(req, res)) return;
  try {
    await withLockedAppDataValue('orgChartVersions', (list) => {
      const applied = orgChart.getAppliedVersion(list);
      if (!applied) throw new HttpError(400, 'Chưa có phiên bản cơ cấu tổ chức nào đang áp dụng');
      orgChart.removeKpiFlowRow(applied, Number(req.params.rowId));
      return list;
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, 'DELETE /api/org-chart/kpi-flow/:rowId', 'Không thể gỡ quan hệ đánh giá');
  }
});

// GET /api/org-chart/kpi-evaluators/:username — tra người đánh giá KPI hiện tại của 1 nhân viên (thay
// modal "🎯 KPI" chỉ-đọc bản cũ, resolveKpiEvaluatorForUser()).
router.get('/kpi-evaluators/:username', async (req, res) => {
  if (!requireView(req, res)) return;
  try {
    const list = (await getAppDataValue('orgChartVersions')) || [];
    const applied = orgChart.getAppliedVersion(list);
    const users = (await getAppDataValue('users')) || [];
    const user = users.find(u => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
    const result = orgChart.resolveKpiEvaluatorsForUser(applied, user, users);
    res.json({ result });
  } catch (err) { sendCatchError(res, err, 'GET /api/org-chart/kpi-evaluators/:username'); }
});

module.exports = router;
