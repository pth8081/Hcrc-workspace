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
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const uploadRateLimiter = require('../lib/uploadRateLimiter');
const { verifyFileSignature } = require('../lib/fileSignature');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { getAppDataValue, withLockedAppDataValue } = require('../lib/appData');
const { HttpError } = require('../lib/httpErrors');
const { sendServerError, sendCatchError } = require('../lib/errorResponse');
const orgChart = require('../lib/orgChart');
const orgChartImport = require('../lib/orgChartImport');
const { insertSystemLog } = require('../lib/systemLogStore');
const { computeHeadcountReport } = require('../lib/headcountReport');
const { buildGenericWorkbook } = require('../lib/adminExport');
const { fixUploadedFilename } = require('../lib/uploadFilename');
const { getAllForCollection } = require('../lib/recordStore');

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

// POST /api/org-chart/versions/:id/delete — xoá hẳn 1 bản nháp (DRAFT) không dùng nữa (tạo thử/nhân
// bản nhầm) — chỉ DRAFT, orgChart.deleteVersion() tự chặn APPLIED/ARCHIVED (phải giữ lại làm lịch sử).
router.post('/versions/:id/delete', async (req, res) => {
  if (!requireManageTree(req, res)) return;
  try {
    await withLockedAppDataValue('orgChartVersions', (list) => orgChart.deleteVersion(list, Number(req.params.id)));
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, 'POST /api/org-chart/versions/:id/delete', 'Không thể xoá phiên bản');
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
    // employeeProfiles (LỖI ĐÃ VÁ #9, xem chú thích tại resolvePositionOccupants() ở lib/orgChart.js) —
    // không chặn xoá vị trí nhầm vì "người giữ" thật ra đã hoàn tất Offboarding.
    const employeeProfiles = (await getAppDataValue('employeeProfiles')) || [];
    let deletedIds;
    await withLockedAppDataValue('orgChartVersions', (list) => {
      const version = orgChart.requireVersion(list, Number(req.params.id));
      deletedIds = orgChart.deleteNodeCascade(version, Number(req.params.nodeId), users, employeeProfiles);
      return list;
    });
    res.json({ ok: true, deletedNodeIds: deletedIds });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, 'DELETE /api/org-chart/versions/:id/nodes/:nodeId', 'Không thể xoá node');
  }
});

// ===== Tải Mẫu / Nhập / Xuất Excel (10/2026, theo yêu cầu người dùng) =====
// KHÁC hẳn mọi Excel Nhập khác trong hệ thống — xem chú thích đầu lib/orgChartImport.js: Cơ Cấu Tổ
// Chức là CÂY, Nhập Excel LUÔN tạo 1 bản Nháp MỚI (không gộp vào bản đang có), tất-cả-hoặc-không-gì.
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_MB = parseInt(process.env.UPLOAD_MAX_MB || '20', 10);
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED_EXT = new Set(['.xlsx', '.xls']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ALLOWED_EXT.has(ext) ? ext : ''}`);
    }
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new HttpError(400, `Chỉ chấp nhận file Excel (.xlsx/.xls), không hỗ trợ: ${ext || '(không rõ)'}`));
    cb(null, true);
  }
});

// GET /api/org-chart/import-template — mẫu Excel để HR điền cả cây tổ chức (hoặc 1 nhánh lớn) rồi nhập
// hàng loạt, thay vì bấm "+ Thêm" từng node một.
router.get('/import-template', async (req, res) => {
  if (!requireManageTree(req, res)) return;
  try {
    const [depts, stores, jobTitles, storeJobTitles, jobGrades] = await Promise.all([
      getAppDataValue('depts'), getAppDataValue('stores'), getAppDataValue('jobTitles'),
      getAppDataValue('storeJobTitles'), getAppDataValue('jobGrades')
    ]);
    const wb = await orgChartImport.buildImportTemplateWorkbook({ depts, stores, jobTitles, storeJobTitles, jobGrades });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Co_Cau_To_Chuc.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/org-chart/import-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// POST /api/org-chart/parse-import — đọc file đã điền, trả về xem trước (từng dòng + lỗi cấu trúc cây
// tổng thể) — CHƯA tạo gì. HR xác nhận nhập thật ở POST /import-confirm.
router.post('/parse-import', uploadRateLimiter, (req, res) => {
  if (!requireManageTree(req, res)) return;
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, 'POST /api/org-chart/parse-import');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp Cơ Cấu Tổ Chức cần tải lên' });
    req.file.originalname = fixUploadedFilename(req.file.originalname);
    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, ext);
      if (!check.ok) return res.status(400).json({ error: check.reason });
      const result = await orgChartImport.parseImportExcelBuffer(buffer);
      res.json(Object.assign({ fileName: req.file.originalname }, result));
    } catch (parseErr) {
      sendCatchError(res, parseErr, 'POST /api/org-chart/parse-import');
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });
});

// POST /api/org-chart/import-confirm — xác nhận nhập thật: tạo 1 bản Nháp MỚI dựng lại từ "items" đã
// nhận ở /parse-import (client echo lại nguyên vẹn, server LUÔN re-validate — xem chú thích
// buildDraftVersionFromRows() ở lib/orgChartImport.js). Body: { items: [...], versionName }.
router.post('/import-confirm', async (req, res) => {
  if (!requireManageTree(req, res)) return;
  try {
    let created;
    await withLockedAppDataValue('orgChartVersions', (list) => {
      created = orgChartImport.buildDraftVersionFromRows(list, req.body?.items, req.body?.versionName, req.freshUser.username);
      return [...list, created];
    });
    insertSystemLog({
      username: req.freshUser?.username || req.user?.username, fullName: req.freshUser?.name || req.user?.username, ipAddress: req.ip,
      module: 'SYSTEM', actionType: 'ORGCHART_IMPORT_EXCEL',
      targetObject: `orgChartVersions#${created.id}`,
      description: `Nhập Excel Cơ Cấu Tổ Chức — tạo bản nháp mới [${created.id}] "${created.versionName}" với ${created.nodes.length} node`,
      status: 'SUCCESS'
    }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (nhập Excel Cơ Cấu Tổ Chức):', e.message));
    res.json({ ok: true, version: created });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, 'POST /api/org-chart/import-confirm', 'Không thể tạo bản nháp từ file');
  }
});

// GET /api/org-chart/versions/:id/export-xlsx — xuất cây tổ chức của 1 version (DRAFT/APPLIED/ARCHIVED
// bất kỳ) ra ĐÚNG layout Excel Nhập ở trên, để tải về sửa rồi nhập lại (vòng tròn tải-sửa-nhập).
router.get('/versions/:id/export-xlsx', async (req, res) => {
  if (!requireView(req, res)) return;
  try {
    const list = (await getAppDataValue('orgChartVersions')) || [];
    const version = orgChart.requireVersion(list, Number(req.params.id));
    const wb = orgChartImport.buildExportWorkbook(version);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Co_Cau_To_Chuc_${version.id}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('GET /api/org-chart/versions/:id/export-xlsx lỗi:', err.message);
    res.status(500).json({ error: 'Không thể xuất file' });
  }
});

// GET /api/org-chart/versions/:id/headcount-report — Báo Cáo Định Biên Nhân Sự (10/2026): "Thực tế"
// tính ĐỘNG từ employeeProfiles/hrProcesses/users (xem lib/headcountReport.js), KHÔNG đọc/ghi gì thêm.
async function loadHeadcountReport(versionId) {
  const list = (await getAppDataValue('orgChartVersions')) || [];
  const version = orgChart.requireVersion(list, Number(versionId));
  const [employeeProfiles, hrProcesses, users] = await Promise.all([
    getAppDataValue('employeeProfiles').then(v => v || []),
    getAllForCollection('hrProcesses'),
    getAppDataValue('users').then(v => v || [])
  ]);
  return { version, report: computeHeadcountReport(version, employeeProfiles, hrProcesses, users) };
}
router.get('/versions/:id/headcount-report', async (req, res) => {
  if (!requireView(req, res)) return;
  try {
    const { report } = await loadHeadcountReport(req.params.id);
    res.json(report);
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, 'GET /api/org-chart/versions/:id/headcount-report', 'Không thể tính báo cáo định biên');
  }
});

// GET /api/org-chart/versions/:id/headcount-report/export-xlsx — cùng dữ liệu route JSON trên, xuất
// thẳng ra Excel (reuse buildGenericWorkbook() — lib/adminExport.js, đúng khuôn 1 sheet {columns, rows}).
router.get('/versions/:id/headcount-report/export-xlsx', async (req, res) => {
  if (!requireView(req, res)) return;
  try {
    const { version, report } = await loadHeadcountReport(req.params.id);
    const columns = [
      { header: 'Cấp / Tên', key: 'displayName', width: 40 },
      { header: 'Chức Danh', key: 'jobTitle', width: 26 },
      { header: 'Cấp Bậc', key: 'jobGrade', width: 10 },
      { header: 'Định Biên', key: 'quota', width: 10 },
      { header: 'Thực Tế', key: 'actualTotal', width: 10 },
      { header: 'Chênh Lệch', key: 'variance', width: 10 },
      { header: 'Đang Làm Việc', key: 'active', width: 12 },
      { header: 'Đang Bàn Giao Nghỉ Việc', key: 'offboarding', width: 16 },
      { header: 'Thai Sản/Nghỉ Ốm', key: 'onLeave', width: 14 },
      { header: 'Kiêm Nhiệm', key: 'secondary', width: 10 },
      { header: 'Mã Vị Trí', key: 'positionKey', width: 28 }
    ];
    const rows = report.rows.map(r => ({
      displayName: `${'　'.repeat(r.level)}${r.displayName || ''}`,
      jobTitle: r.jobTitle || '', jobGrade: r.jobGrade || '',
      quota: r.quota == null ? '' : r.quota, actualTotal: r.actualTotal,
      variance: r.variance == null ? '' : r.variance,
      active: r.active, offboarding: r.offboarding, onLeave: r.onLeave, secondary: r.secondary,
      positionKey: r.positionKey || ''
    }));
    const wb = buildGenericWorkbook('Dinh Bien Nhan Su', columns, rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Dinh_Bien_Nhan_Su_${version.id}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error('GET /api/org-chart/versions/:id/headcount-report/export-xlsx lỗi:', err.message);
    res.status(500).json({ error: 'Không thể xuất file' });
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
    const employeeProfiles = (await getAppDataValue('employeeProfiles')) || []; // LỖI ĐÃ VÁ #9
    const issues = orgChart.computeValidationIssues(version, applied, users, employeeProfiles);
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
    const employeeProfilesSnapshot = (await getAppDataValue('employeeProfiles')) || []; // LỖI ĐÃ VÁ #9
    await withLockedAppDataValue('orgChartVersions', (list) => {
      appliedVersion = orgChart.applyVersionInPlace(list, Number(req.params.id), usersSnapshot, req.freshUser.username, employeeProfilesSnapshot);
      return list;
    });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    return sendServerError(res, 500, err, 'POST /api/org-chart/versions/:id/apply', 'Không thể áp dụng phiên bản');
  }
  let unresolved = [];
  let changedCount = 0;
  try {
    const employeeProfiles = (await getAppDataValue('employeeProfiles')) || []; // LỖI ĐÃ VÁ #9
    await withLockedAppDataValue('users', (currentUsers) => {
      const { changes, unresolved: u } = orgChart.computeManagerUsernameUpdates(appliedVersion, currentUsers, employeeProfiles);
      unresolved = u;
      changedCount = changes.length;
      return orgChart.applyManagerUsernameUpdates(currentUsers, changes);
    });
  } catch (err) {
    console.error('⛔ Áp dụng cơ cấu tổ chức thành công nhưng lỗi khi tự cập nhật Quản Lý Trực Tiếp:', err.message);
    unresolved = [{ username: '', name: '', reason: 'Lỗi hệ thống khi tự cập nhật Quản Lý Trực Tiếp — vui lòng kiểm tra thủ công' }];
  }
  // LỖI ĐÃ VÁ (đợt audit chuyên sâu 9/2026, cụm Hệ Thống/Admin/Cấu Hình, mức Trung bình): route này ghi
  // THẲNG vào collection "users" (admin-sensitive, nằm trong ADMIN_SENSITIVE_KEYS — xem
  // logAdminSensitiveDataWrite() ở routes/data.js) qua withLockedAppDataValue() thay vì POST
  // /api/data/users, nên bỏ qua HOÀN TOÀN lớp audit ADMIN_DATA_WRITE đã dựng ở vòng 1 — 1 lượt "Áp dụng"
  // cây tổ chức có thể đổi managerUsername của HÀNG CHỤC user cùng lúc mà không để lại dấu vết Nhật Ký
  // Hệ Thống nào. Ghi log SERVER-SIDE riêng tại đây (fire-and-forget, không làm hỏng response đã tính
  // xong), nêu rõ số user bị đổi managerUsername + ai thực hiện.
  insertSystemLog({
    username: req.freshUser?.username || req.user?.username, fullName: req.freshUser?.name || req.user?.username, ipAddress: req.ip,
    module: 'SYSTEM', actionType: 'ORGCHART_APPLY_VERSION',
    targetObject: `orgChartVersions#${appliedVersion?.id ?? req.params.id}`,
    description: `Áp dụng phiên bản Cơ Cấu Tổ Chức [${appliedVersion?.id ?? req.params.id}] — tự cập nhật Quản Lý Trực Tiếp cho ${changedCount} user`
      + (unresolved.length ? ` (${unresolved.length} user KHÔNG suy ra được, cần kiểm tra thủ công)` : ''),
    status: unresolved.length ? 'WARNING' : 'SUCCESS'
  }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (áp dụng Cơ Cấu Tổ Chức):', e.message));
  res.json({ ok: true, version: appliedVersion, unresolvedManagerUsers: unresolved });
});

// POST /api/org-chart/recompute-manager-usernames — Đợt 4 (vá gap #2 Phần A/B): đồng bộ lại
// managerUsername theo ĐÚNG cây version đang APPLIED mà KHÔNG cần tạo bản nháp mới rồi "Áp dụng" —
// dùng khi HR chỉ vừa đổi nhanh dept/jobTitle của 1-2 người (đề bạt thay 1 vị trí quản lý vừa nghỉ...)
// ở màn Sửa Người Dùng, việc trước đây CHỈ tự đồng bộ khi áp dụng version cây tổ chức mới (xem
// computeManagerUsernameUpdates()/applyVersionInPlace() ở lib/orgChart.js) — HR dễ quên phải tạo hẳn 1
// version mới chỉ để refresh managerUsername. Tái dùng ĐÚNG 2 hàm lõi ở trên, chỉ khác không kèm bước
// validate+apply version.
router.post('/recompute-manager-usernames', async (req, res) => {
  if (!requireManageTree(req, res)) return;
  try {
    const list = (await getAppDataValue('orgChartVersions')) || [];
    const applied = orgChart.getAppliedVersion(list);
    if (!applied) return res.status(400).json({ error: 'Chưa có phiên bản Cơ Cấu Tổ Chức nào đang áp dụng' });
    const employeeProfiles = (await getAppDataValue('employeeProfiles')) || []; // LỖI ĐÃ VÁ #9
    let unresolved = [];
    let changedCount = 0;
    await withLockedAppDataValue('users', (currentUsers) => {
      const { changes, unresolved: u } = orgChart.computeManagerUsernameUpdates(applied, currentUsers, employeeProfiles);
      unresolved = u;
      changedCount = changes.length;
      return orgChart.applyManagerUsernameUpdates(currentUsers, changes);
    });
    // LỖI ĐÃ VÁ — cùng phát hiện/lý do với POST /versions/:id/apply ở trên (ghi thẳng "users" qua
    // withLockedAppDataValue(), bỏ qua lớp audit ADMIN_DATA_WRITE).
    insertSystemLog({
      username: req.freshUser?.username || req.user?.username, fullName: req.freshUser?.name || req.user?.username, ipAddress: req.ip,
      module: 'SYSTEM', actionType: 'ORGCHART_RECOMPUTE_MANAGERS',
      targetObject: `orgChartVersions#${applied.id}`,
      description: `Đồng bộ lại Quản Lý Trực Tiếp theo Cơ Cấu Tổ Chức [${applied.id}] đang áp dụng — cập nhật ${changedCount} user`
        + (unresolved.length ? ` (${unresolved.length} user KHÔNG suy ra được, cần kiểm tra thủ công)` : ''),
      status: unresolved.length ? 'WARNING' : 'SUCCESS'
    }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (đồng bộ Quản Lý Trực Tiếp):', e.message));
    res.json({ ok: true, unresolvedManagerUsers: unresolved });
  } catch (err) {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    sendServerError(res, 500, err, 'POST /api/org-chart/recompute-manager-usernames', 'Không thể đồng bộ Quản Lý Trực Tiếp');
  }
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
    const employeeProfiles = (await getAppDataValue('employeeProfiles')) || []; // LỖI ĐÃ VÁ #9
    const byId = new Map((applied.nodes || []).map(n => [n.nodeId, n]));
    const rows = (applied.kpiFlow || []).map(f => {
      const evaluator = byId.get(f.evaluatorNodeId);
      const evaluatee = byId.get(f.evaluateeNodeId);
      return {
        id: f.id, isAutoFromHierarchy: f.isAutoFromHierarchy,
        evaluatorNodeId: f.evaluatorNodeId, evaluateeNodeId: f.evaluateeNodeId,
        evaluatorName: evaluator ? orgChart.buildNodeDisplayName(applied, evaluator) : '',
        evaluateeName: evaluatee ? orgChart.buildNodeDisplayName(applied, evaluatee) : '',
        evaluatorOccupants: evaluator ? orgChart.resolvePositionOccupants(applied, evaluator, users, employeeProfiles) : [],
        evaluateeOccupants: evaluatee ? orgChart.resolvePositionOccupants(applied, evaluatee, users, employeeProfiles) : []
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
    const employeeProfiles = (await getAppDataValue('employeeProfiles')) || []; // LỖI ĐÃ VÁ #9
    const user = users.find(u => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy nhân viên' });
    const result = orgChart.resolveKpiEvaluatorsForUser(applied, user, users, employeeProfiles);
    res.json({ result });
  } catch (err) { sendCatchError(res, err, 'GET /api/org-chart/kpi-evaluators/:username'); }
});

module.exports = router;
