// routes/employeeProfile.js — Hồ Sơ Nhân Sự (Phần C, đợt 1/4 module Nhân Sự — sau Cơ Cấu Tổ Chức/
// Onboarding-Offboarding đã build). Route RIÊNG (không qua GET /api/data chung) vì cần strip field nhạy
// cảm THEO TỪNG VAI TRÒ NGƯỜI XEM (xem lib/employeeProfile.js::getProfileForViewer()) — routes/data.js
// chỉ lọc theo ITEM (ẩn/hiện cả bản ghi), không strip field bên trong 1 bản ghi được phép xem.
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { getAppDataValue, getAllAppData, withLockedAppDataValue } = require('../lib/appData');
const { getAllForCollection } = require('../lib/recordStore');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');
const { verifyFileSignature } = require('../lib/fileSignature');
const employeeProfile = require('../lib/employeeProfile');
const employeeProfileImport = require('../lib/employeeProfileImport');
const { canManageContracts } = require('../lib/laborContract');
const orgChart = require('../lib/orgChart');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

function requireProfileManage(req, res, next) {
  if (!employeeProfile.canManageProfiles(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền quản lý Hồ Sơ Nhân Sự' });
  next();
}

// Xác nhận username (nếu có) khớp ĐÚNG 1 tài khoản VPDT đang hoạt động — dùng chung cho tạo tay + import
// hàng loạt, cùng luật với POST /by-code/:employeeCode/link-account bên dưới.
function assertActiveAccountIfGiven(username, allUsers) {
  if (!username) return;
  const account = (allUsers || []).find(u => u.username === username && u.active !== false);
  if (!account) throw new HttpError(400, `Tài khoản VPDT "${username}" không tồn tại hoặc đã bị khoá`);
}

const uploadRateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Bạn đang tải lên quá nhiều tệp, vui lòng thử lại sau ít phút.' }
});
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

function stripForList(profile) {
  return {
    employeeCode: profile.employeeCode, username: profile.username, status: profile.status,
    updatedAt: profile.updatedAt
  };
}

// GET /api/hr-profile/me — hồ sơ của chính người đang đăng nhập (luôn xem đủ — chính chủ).
router.get('/me', async (req, res) => {
  try {
    const list = (await getAppDataValue('employeeProfiles')) || [];
    const profile = employeeProfile.findProfileByUsername(list, req.freshUser.username);
    if (!profile) return res.status(404).json({ error: 'Bạn chưa có Hồ Sơ Nhân Sự (có thể tài khoản chưa được liên kết với hồ sơ Onboarding)' });
    res.json({ profile });
  } catch (err) { sendCatchError(res, err, 'GET /api/hr-profile/me'); }
});

// PATCH /api/hr-profile/me — tự sửa trường tự phục vụ (SELF_EDITABLE_FIELDS).
router.patch('/me', async (req, res) => {
  try {
    let updated;
    await withLockedAppDataValue('employeeProfiles', (list) => {
      const profile = employeeProfile.findProfileByUsername(list, req.freshUser.username);
      if (!profile) throw new HttpError(404, 'Bạn chưa có Hồ Sơ Nhân Sự');
      employeeProfile.applyProfileEdit(profile, req.body, employeeProfile.SELF_EDITABLE_FIELDS, req.freshUser.username);
      updated = profile;
      return list;
    });
    res.json({ ok: true, profile: updated });
  } catch (err) { sendCatchError(res, err, 'PATCH /api/hr-profile/me'); }
});

// GET /api/hr-profile — danh sách nhẹ (HR/admin only) — dùng cho màn quản lý, không lộ field nhạy cảm.
router.get('/', async (req, res) => {
  try {
    if (!employeeProfile.canManageProfiles(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền xem danh sách Hồ Sơ Nhân Sự' });
    const list = (await getAppDataValue('employeeProfiles')) || [];
    res.json({ profiles: list.map(stripForList) });
  } catch (err) { sendCatchError(res, err, 'GET /api/hr-profile'); }
});

// GET /api/hr-profile/employee-directory — danh sách CỰC nhẹ (chỉ employeeCode + tên hiển thị, KHÔNG
// có field nhạy cảm/username/status) — dùng cho picker "chọn nhân viên theo Hồ Sơ" ở module KHÁC (VD
// Hợp Đồng Lao Động, xem module-hopdonglaodong.js). Mở quyền RỘNG HƠN GET / (chỉ hrProfileManage) —
// thêm cả hrContractManage vì 2 quyền này có thể gán cho người KHÁC nhau, người chỉ quản lý Hợp Đồng
// Lao Động vẫn cần tra được mã nhân viên hợp lệ dù không có hrProfileManage. Loại "Đã nghỉ việc"
// (INACTIVE) — tạo hợp đồng lao động mới cho người đã nghỉ là vô lý.
router.get('/employee-directory', async (req, res) => {
  try {
    if (!employeeProfile.canManageProfiles(req.freshUser) && !canManageContracts(req.freshUser)) {
      return res.status(403).json({ error: 'Bạn không có quyền tra cứu danh sách nhân viên từ Hồ Sơ Nhân Sự' });
    }
    const appData = await getAllAppData();
    const list = (appData.employeeProfiles || []).filter(p => p.status !== 'INACTIVE');
    const directory = list.map(p => ({
      employeeCode: p.employeeCode,
      fullName: employeeProfile.resolveProfileDisplayName(p, appData.users, appData.hrProcesses)
    }));
    res.json({ directory });
  } catch (err) { sendCatchError(res, err, 'GET /api/hr-profile/employee-directory'); }
});

// GET /api/hr-profile/position-options — danh sách phẳng mọi vị trí (node POSITION) của bản Cơ Cấu Tổ
// Chức ĐANG ÁP DỤNG — dùng cho ô tìm-kiếm-gõ-chọn "Chức Vụ" ở Hồ Sơ Nhân Sự (module-hrprofile.js). Chỉ
// HR/admin (canManageProfiles) — trùng quyền được phép gán chức vụ (POST .../set-position bên dưới).
router.get('/position-options', requireProfileManage, async (req, res) => {
  try {
    const orgChartVersions = (await getAppDataValue('orgChartVersions')) || [];
    const applied = orgChart.getAppliedVersion(orgChartVersions);
    if (!applied) return res.json({ positions: [] });
    const positions = (applied.nodes || [])
      .filter(n => n.nodeType === 'POSITION')
      .map(n => ({ positionKey: n.positionKey, label: orgChart.buildNodeDisplayName(applied, n) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'vi'));
    res.json({ positions });
  } catch (err) { sendCatchError(res, err, 'GET /api/hr-profile/position-options'); }
});

// POST /api/hr-profile/by-code/:employeeCode/set-position — HR/admin gán/đổi chức vụ, LUÔN chọn từ 1
// node POSITION có thật trong bản Cơ Cấu Tổ Chức đang áp dụng (xem applyPositionAssignment()). Nếu hồ
// sơ đã liên kết tài khoản VPDT, đồng bộ GHI ĐÈ luôn dept/jobTitle của tài khoản đó ngay sau khi ghi
// xong hồ sơ (2 lệnh khoá TUẦN TỰ trên 2 collection khác nhau — employeeProfiles rồi users — không phải
// 1 giao dịch chéo collection, cùng cách catalogRename.js xử lý cascade nhiều collection) — đã xác nhận
// với người dùng: Hồ Sơ Nhân Sự là nguồn CHÍNH THỨC cho chức vụ/phòng ban, tài khoản chỉ còn ý nghĩa
// liên hệ đăng nhập/tra cứu chéo module, nhưng CẦN khớp đúng để Cơ Cấu Tổ Chức + phân quyền theo phòng
// ban ở các module khác không bị lệch. posType chỉ đồng bộ nếu node có gán (result.posType khác null) —
// vị trí CHƯA cấu hình posType thì giữ nguyên posType hiện có của tài khoản (không ghi đè bằng null), vì
// module Công & Phép (lib/attendance.js) dựa vào posType để xác định mô hình chấm công OFFICE_HOURS/
// SHIFT_BASED — xem chú thích tại lib/orgChart.js mục 5.
router.post('/by-code/:employeeCode/set-position', async (req, res) => {
  try {
    if (!employeeProfile.canManageProfiles(req.freshUser)) return res.status(403).json({ error: 'Chỉ HR/Admin mới gán chức vụ' });
    const positionKey = String(req.body?.positionKey || '').trim();
    if (!positionKey) return res.status(400).json({ error: 'Vui lòng chọn chức vụ từ Cơ Cấu Tổ Chức' });
    const effectiveDate = req.body?.effectiveDate ? String(req.body.effectiveDate).trim() : null;
    const note = req.body?.note;
    const orgChartVersions = (await getAppDataValue('orgChartVersions')) || [];
    const applied = orgChart.getAppliedVersion(orgChartVersions);
    let updated, syncTarget = null;
    await withLockedAppDataValue('employeeProfiles', (list) => {
      const profile = employeeProfile.findProfile(list, req.params.employeeCode);
      if (!profile) throw new HttpError(404, 'Không tìm thấy hồ sơ');
      const result = employeeProfile.applyPositionAssignment(profile, applied, positionKey, effectiveDate, req.freshUser.username, req.freshUser.name, note);
      updated = profile;
      if (profile.username) syncTarget = { username: profile.username, jobTitle: result.jobTitle, dept: result.dept, posType: result.posType };
      return list;
    });
    if (syncTarget) {
      await withLockedAppDataValue('users', (list) => (list || []).map(u =>
        u.username === syncTarget.username ? { ...u, jobTitle: syncTarget.jobTitle, dept: syncTarget.dept, ...(syncTarget.posType ? { posType: syncTarget.posType } : {}) } : u
      ));
    }
    res.json({ ok: true, profile: updated });
  } catch (err) { sendCatchError(res, err, `POST /api/hr-profile/by-code/${req.params.employeeCode}/set-position`); }
});

// GET /api/hr-profile/by-code/:employeeCode/history — "Lịch Sử Nhân Sự" gộp xuyên suốt hồ sơ: chức vụ
// (profile.positionHistory[]) + toàn bộ hợp đồng lao động của nhân viên này (mã hợp đồng ký MỚI/kích
// hoạt/thay thế/chấm dứt từ laborContracts[].history[] + các dòng "Bổ Sung Phụ Lục" từ amendments[]) —
// xem yêu cầu "muốn có lịch sử này xuyên suốt hồ sơ nhân sự" đã xác nhận với người dùng. Quyền: CẦN CẢ
// hrProfileManage LẪN hrContractManage (hoặc admin) — cố ý CHẶT hơn từng route riêng lẻ ở trên, vì dữ
// liệu hợp đồng gộp vào đây có LƯƠNG (trường vốn chỉ admin/hrContractManage được đọc, xem
// canViewLaborContract() ở lib/recordViewScope.js) — không nới lỏng biên giới đó chỉ vì gộp chung 1 màn.
router.get('/by-code/:employeeCode/history', async (req, res) => {
  try {
    const canFull = employeeProfile.canManageProfiles(req.freshUser) && canManageContracts(req.freshUser);
    if (!canFull) return res.status(403).json({ error: 'Cần đồng thời quyền Quản Lý Hồ Sơ Nhân Sự và Quản Lý Hợp Đồng Lao Động (hoặc admin) để xem Lịch Sử Nhân Sự đầy đủ' });
    const list = (await getAppDataValue('employeeProfiles')) || [];
    const profile = employeeProfile.findProfile(list, req.params.employeeCode);
    if (!profile) return res.status(404).json({ error: 'Không tìm thấy hồ sơ' });
    const events = [];
    for (const h of (profile.positionHistory || [])) {
      events.push({
        type: 'POSITION', time: h.createdAt, date: h.effectiveDate,
        title: h.oldPositionLabel ? `Đổi chức vụ: "${h.oldPositionLabel}" → "${h.newPositionLabel}"` : `Bổ nhiệm chức vụ: "${h.newPositionLabel}"`,
        detail: h.note || null, by: h.changedByName || h.changedBy
      });
    }
    const contracts = (await getAllForCollection('laborContracts')).filter(c => c.employeeCode === profile.employeeCode);
    for (const c of contracts) {
      for (const h of (c.history || [])) {
        events.push({ type: 'CONTRACT', time: h.time, date: (h.time || '').slice(0, 10), title: `Hợp đồng ${c.code}: ${h.detail || h.action}`, detail: null, by: h.byName || h.by });
      }
      for (const a of (c.amendments || [])) {
        events.push({
          type: 'CONTRACT_AMENDMENT', time: a.createdAt, date: a.effectiveDate,
          title: `Hợp đồng ${c.code} — Phụ lục: ${a.amendmentType}`,
          detail: [a.oldValue ? `Cũ: ${a.oldValue}` : null, a.newValue ? `Mới: ${a.newValue}` : null, a.note].filter(Boolean).join(' — ') || null,
          by: a.createdByName || a.createdBy
        });
      }
    }
    events.sort((x, y) => (y.time || '').localeCompare(x.time || ''));
    res.json({ events });
  } catch (err) { sendCatchError(res, err, `GET /api/hr-profile/by-code/${req.params.employeeCode}/history`); }
});

// GET /api/hr-profile/by-code/:employeeCode — HR/admin (đủ) hoặc quản lý trực tiếp (giới hạn, xem
// getProfileForViewer()). Không cho tra cứu tự do — trả 404 luôn nếu không đủ quyền (không phân biệt
// "hồ sơ không tồn tại" với "không có quyền xem" để tránh dò quét employeeCode).
router.get('/by-code/:employeeCode', async (req, res) => {
  try {
    const appData = await getAllAppData();
    const list = appData.employeeProfiles || [];
    const profile = employeeProfile.findProfile(list, req.params.employeeCode);
    if (!profile) return res.status(404).json({ error: 'Không tìm thấy hồ sơ' });
    const viewable = employeeProfile.getProfileForViewer(profile, req.freshUser, appData.users || []);
    if (!viewable) return res.status(404).json({ error: 'Không tìm thấy hồ sơ' });
    res.json({ profile: viewable });
  } catch (err) { sendCatchError(res, err, `GET /api/hr-profile/by-code/${req.params.employeeCode}`); }
});

// GET /api/hr-profile/by-username/:username — CÙNG mục đích/quyền như /by-code ở trên (getProfileForViewer()
// 3-tầng), chỉ khác điểm tra cứu: "quản lý trực tiếp" (hrProfileView, KHÔNG có hrProfileManage) không gọi
// được GET / (403, chỉ HR/admin) nên không có employeeCode trong tay — họ chỉ biết username của nhân viên
// (đã có sẵn từ DB.users, danh sách người mình quản lý). Tra theo username qua route riêng này thay vì bắt
// họ tự dò employeeCode. Cùng quy tắc 404 mơ hồ (không phân biệt "không tồn tại" với "không có quyền").
router.get('/by-username/:username', async (req, res) => {
  try {
    const appData = await getAllAppData();
    const list = appData.employeeProfiles || [];
    const profile = employeeProfile.findProfileByUsername(list, req.params.username);
    if (!profile) return res.status(404).json({ error: 'Không tìm thấy hồ sơ' });
    const viewable = employeeProfile.getProfileForViewer(profile, req.freshUser, appData.users || []);
    if (!viewable) return res.status(404).json({ error: 'Không tìm thấy hồ sơ' });
    res.json({ profile: viewable });
  } catch (err) { sendCatchError(res, err, `GET /api/hr-profile/by-username/${req.params.username}`); }
});

// PATCH /api/hr-profile/by-code/:employeeCode — HR/admin sửa TOÀN BỘ trường (kể cả HR_ONLY_EDITABLE_FIELDS).
router.patch('/by-code/:employeeCode', async (req, res) => {
  try {
    if (!employeeProfile.canManageProfiles(req.freshUser)) return res.status(403).json({ error: 'Chỉ HR/Admin mới sửa được hồ sơ người khác' });
    let updated;
    await withLockedAppDataValue('employeeProfiles', (list) => {
      const profile = employeeProfile.findProfile(list, req.params.employeeCode);
      if (!profile) throw new HttpError(404, 'Không tìm thấy hồ sơ');
      const allowed = [...employeeProfile.SELF_EDITABLE_FIELDS, ...employeeProfile.HR_ONLY_EDITABLE_FIELDS];
      employeeProfile.applyProfileEdit(profile, req.body, allowed, req.freshUser.username);
      updated = profile;
      return list;
    });
    res.json({ ok: true, profile: updated });
  } catch (err) { sendCatchError(res, err, `PATCH /api/hr-profile/by-code/${req.params.employeeCode}`); }
});

// PATCH /api/hr-profile/by-code/:employeeCode/status — HR/admin đổi tay ACTIVE<->ON_LEAVE.
router.patch('/by-code/:employeeCode/status', async (req, res) => {
  try {
    if (!employeeProfile.canManageProfiles(req.freshUser)) return res.status(403).json({ error: 'Chỉ HR/Admin mới đổi trạng thái hồ sơ' });
    let updated;
    await withLockedAppDataValue('employeeProfiles', (list) => {
      const profile = employeeProfile.findProfile(list, req.params.employeeCode);
      if (!profile) throw new HttpError(404, 'Không tìm thấy hồ sơ');
      employeeProfile.assertValidManualStatusTransition(profile.status, req.body?.status);
      profile.status = req.body.status;
      profile.updatedAt = new Date().toLocaleString('vi-VN');
      profile.updatedBy = req.freshUser.username;
      updated = profile;
      return list;
    });
    res.json({ ok: true, profile: updated });
  } catch (err) { sendCatchError(res, err, `PATCH /api/hr-profile/by-code/${req.params.employeeCode}/status`); }
});

// POST /api/hr-profile/by-code/:employeeCode/link-account — HR/admin liên kết hồ sơ (đang khoá theo
// employeeCode) với 1 tài khoản VPDT thật đã tồn tại (thường gọi ngay sau khi IT hoàn thành task "Tạo
// email công ty & tài khoản VPDT" ở quy trình Onboarding — xem đầu file lib/employeeProfile.js).
router.post('/by-code/:employeeCode/link-account', async (req, res) => {
  try {
    if (!employeeProfile.canManageProfiles(req.freshUser)) return res.status(403).json({ error: 'Chỉ HR/Admin mới liên kết tài khoản VPDT' });
    const username = String(req.body?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'Vui lòng chọn tài khoản VPDT cần liên kết' });
    const appData = await getAllAppData();
    const account = (appData.users || []).find(u => u.username === username && u.active !== false);
    if (!account) return res.status(400).json({ error: 'Không tìm thấy tài khoản VPDT này (hoặc đã bị khoá)' });
    let updated;
    await withLockedAppDataValue('employeeProfiles', (list) => {
      updated = employeeProfile.linkAccount(list, req.params.employeeCode, username, req.freshUser.username);
      return list;
    });
    res.json({ ok: true, profile: updated });
  } catch (err) { sendCatchError(res, err, `POST /api/hr-profile/by-code/${req.params.employeeCode}/link-account`); }
});

// POST /api/hr-profile — HR/admin tạo tay 1 hồ sơ MỚI (nhân viên cũ đã đang làm việc, chưa từng qua
// Onboarding nên chưa có hồ sơ) — xem lib/employeeProfile.js::createManualProfile(). payload.positionKey
// (tuỳ chọn) — chức vụ BAN ĐẦU chọn ngay từ Cơ Cấu Tổ Chức lúc tạo, áp dụng NGAY trong cùng giao dịch
// (chính là lần đầu tiên của positionHistory[], không cần thao tác riêng "gán chức vụ" ngay sau đó).
router.post('/', requireProfileManage, async (req, res) => {
  try {
    const username = req.body?.username ? String(req.body.username).trim() : null;
    const positionKey = req.body?.positionKey ? String(req.body.positionKey).trim() : null;
    const appData = await getAllAppData();
    assertActiveAccountIfGiven(username, appData.users || []);
    const applied = positionKey ? orgChart.getAppliedVersion((await getAppDataValue('orgChartVersions')) || []) : null;
    let created, syncTarget = null;
    await withLockedAppDataValue('employeeProfiles', (list) => {
      created = employeeProfile.createManualProfile(list, req.body, req.freshUser.username);
      if (positionKey) {
        const result = employeeProfile.applyPositionAssignment(created, applied, positionKey, null, req.freshUser.username, req.freshUser.name, null);
        if (created.username) syncTarget = { username: created.username, jobTitle: result.jobTitle, dept: result.dept, posType: result.posType };
      }
      return list;
    });
    if (syncTarget) {
      await withLockedAppDataValue('users', (list) => (list || []).map(u =>
        u.username === syncTarget.username ? { ...u, jobTitle: syncTarget.jobTitle, dept: syncTarget.dept, ...(syncTarget.posType ? { posType: syncTarget.posType } : {}) } : u
      ));
    }
    res.json({ ok: true, profile: created });
  } catch (err) { sendCatchError(res, err, 'POST /api/hr-profile'); }
});

// GET /api/hr-profile/import-template — mẫu Excel để HR điền hàng loạt hồ sơ nhân viên cũ.
router.get('/import-template', requireProfileManage, async (req, res) => {
  try {
    const wb = await employeeProfileImport.buildImportTemplateWorkbook();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Mau_Ho_So_Nhan_Su.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/hr-profile/import-template lỗi:', err.message);
    res.status(500).json({ error: 'Không thể tạo file mẫu' });
  }
});

// POST /api/hr-profile/parse-import — đọc file đã điền, trả về xem trước kèm cờ hợp lệ từng dòng (đối
// chiếu trùng Mã NV/Tài khoản với dữ liệu THẬT ngay lúc này) — HR xác nhận nhập thật ở POST /bulk-import.
router.post('/parse-import', uploadRateLimiter, requireProfileManage, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `Tệp vượt quá dung lượng cho phép (${MAX_MB}MB)` });
      return res.status(400).json({ error: err.message });
    }
    if (err) return sendCatchError(res, err, 'POST /api/hr-profile/parse-import');
    if (!req.file) return res.status(400).json({ error: 'Thiếu tệp Hồ Sơ Nhân Sự cần tải lên' });
    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const buffer = fs.readFileSync(req.file.path);
      const check = await verifyFileSignature(buffer, ext);
      if (!check.ok) return res.status(400).json({ error: check.reason });
      const appData = await getAllAppData();
      const items = await employeeProfileImport.parseImportExcelBuffer(buffer, appData.employeeProfiles || [], appData.users || []);
      res.json({ items, fileName: req.file.originalname });
    } catch (parseErr) {
      sendCatchError(res, parseErr, 'POST /api/hr-profile/parse-import');
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });
});

// POST /api/hr-profile/bulk-import — HR xác nhận nhập thật (1 giao dịch khoá DUY NHẤT, atomic — không
// tạo từng hồ sơ 1 request riêng như N lần gọi POST / để tránh nửa chừng lỗi giữa chừng để lại dữ liệu
// vênh). Body: { items: [{employeeCode, username, ...}] } — LUÔN kiểm tra lại từ đầu bên trong transaction
// (không tin cờ "valid" của bước xem trước, dữ liệu có thể đã đổi từ lúc đó).
router.post('/bulk-import', requireProfileManage, async (req, res) => {
  try {
    const rows = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!rows.length) return res.status(400).json({ error: 'Không có hồ sơ nào để nhập' });
    if (rows.length > 500) return res.status(400).json({ error: 'Tối đa 500 hồ sơ/lần nhập' });
    const appData = await getAllAppData();
    for (const row of rows) assertActiveAccountIfGiven(row?.username ? String(row.username).trim() : null, appData.users || []);

    const results = { created: [], skipped: [] };
    await withLockedAppDataValue('employeeProfiles', (list) => {
      for (const row of rows) {
        try {
          const created = employeeProfile.createManualProfile(list, row, req.freshUser.username);
          results.created.push(created.employeeCode);
        } catch (rowErr) {
          results.skipped.push({ employeeCode: row?.employeeCode || '(thiếu Mã NV)', reason: rowErr.message });
        }
      }
      return list;
    });
    res.json({ ok: true, ...results });
  } catch (err) { sendCatchError(res, err, 'POST /api/hr-profile/bulk-import'); }
});

// GET /api/hr-profile/export-xlsx — HR/admin xuất toàn bộ danh sách hồ sơ hiện có ra Excel.
router.get('/export-xlsx', requireProfileManage, async (req, res) => {
  try {
    const appData = await getAllAppData();
    const wb = await employeeProfileImport.buildExportWorkbook(appData.employeeProfiles || [], appData.users || [], appData.hrProcesses || []);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Ho_So_Nhan_Su.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /api/hr-profile/export-xlsx lỗi:', err.message);
    res.status(500).json({ error: 'Không thể xuất file' });
  }
});

module.exports = router;
