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
const { hasModuleAccessServer } = require('../lib/recordViewScope');
const { parseVNDateTime } = require('../lib/recordActions');
const { insertSystemLog } = require('../lib/systemLogStore');

// PHÁT HIỆN theo yêu cầu người dùng (10/2026, "dữ liệu nhạy cảm nhân sự"): Hồ Sơ Nhân Sự trước đây không
// ghi gì vào "Nhật ký hệ thống" — cùng với việc bỏ nhánh admin ở lib/employeeProfile.js, thêm log SERVER-
// SIDE (không phụ thuộc client có gọi POST /api/log hay không) cho MỌI thao tác ghi (tạo/sửa/đổi trạng
// thái/gán chức vụ/liên kết tài khoản/tái tuyển) để admin đối chiếu ai đã xem/sửa gì. Fire-and-forget
// (không chặn response chính, lỗi ghi log không được phép làm hỏng thao tác chính đã thành công).
function logHrProfileAction(req, actionType, targetObject, description) {
  insertSystemLog({
    username: req.user.username, fullName: req.freshUser?.name || req.user.username, ipAddress: req.ip,
    module: 'HR', actionType, targetObject, description, status: 'SUCCESS'
  }).catch(e => console.error('Lỗi ghi nhật ký hệ thống (Hồ Sơ Nhân Sự):', e.message));
}

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

// nowVN()/toLocaleString('vi-VN') sinh chuỗi "HH:mm:ss d/M/yyyy" — KHÔNG sort được bằng so sánh chuỗi
// (localeCompare/</>). 2 helper dưới đây dùng CHUNG cho GET .../history (gộp "Lịch Sử Nhân Sự") để vừa
// lấy đúng mốc thời gian thật (sort) vừa tách đúng phần "ngày" (hiển thị) từ các trường time dạng này
// (VD laborContracts[].history[].time, profile.profileEditHistory[].createdAt).
function vnTime(str) {
  const d = parseVNDateTime(str);
  return d ? d.getTime() : 0;
}
function vnDateOnly(str) {
  const d = parseVNDateTime(str);
  return d ? d.toISOString().slice(0, 10) : (str || '').slice(0, 10);
}

function requireProfileManage(req, res, next) {
  if (!employeeProfile.canManageProfiles(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền quản lý Hồ Sơ Nhân Sự' });
  next();
}
// 3 middleware CHI TIẾT (9/2026, theo yêu cầu người dùng) — xem chú thích đầy đủ ở
// canCreateProfiles()/canEditProfiles()/canFullViewProfiles() (lib/employeeProfile.js). requireProfileManage
// ở trên GIỮ NGUYÊN, dùng cho action "quản lý tổng quát" không rơi gọn vào đúng 1 trong 3 nhóm dưới (hiện
// chỉ còn GET .../history — cố ý CHẶT hơn, xem chú thích riêng tại đó).
function requireProfileCreate(req, res, next) {
  if (!employeeProfile.canCreateProfiles(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền tạo Hồ Sơ Nhân Sự' });
  next();
}
function requireProfileEdit(req, res, next) {
  if (!employeeProfile.canEditProfiles(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền sửa Hồ Sơ Nhân Sự' });
  next();
}
function requireProfileFullView(req, res, next) {
  if (!employeeProfile.canFullViewProfiles(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền xem danh sách Hồ Sơ Nhân Sự' });
  next();
}
// search-inactive/rehire (Tái Tuyển, task đã làm trước) — dùng được bởi CẢ người chỉ có quyền Tạo LẪN
// người có quyền Sửa (2 nhóm khác nhau đều hợp lý cần tính năng này: người tạo hồ sơ mới cần tránh tạo
// trùng, người sửa hồ sơ cần xử lý tiếp 1 hồ sơ cũ).
function requireProfileCreateOrEdit(req, res, next) {
  if (!employeeProfile.canCreateProfiles(req.freshUser) && !employeeProfile.canEditProfiles(req.freshUser)) {
    return res.status(403).json({ error: 'Bạn không có quyền tạo hoặc sửa Hồ Sơ Nhân Sự' });
  }
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

// GET /api/hr-profile/me — hồ sơ của chính người đang đăng nhập (luôn xem đủ — chính chủ — TRỪ field
// admin đã chủ động ẨN qua "Trường Xem Của Chính Mình", 9/2026 theo yêu cầu người dùng — xem GET/PUT
// .../self-field-config bên dưới; mặc định [] = KHÔNG trường nào hiện tới khi admin chủ động chọn, xem
// defaults.js::hrProfileSelfVisibleFields). Trả kèm selfVisibleFields để client biết field nào đang bị ẩn
// mà KHÔNG cần đoán qua việc field đó có mặt hay không trong `profile` (hồ sơ CŨ tạo trước khi có tính
// năng Người phụ thuộc/Học vấn cũng thiếu tự nhiên 2 key này — lẫn lộn 2 nguyên nhân sẽ sai, xem chú
// thích dài ở renderHrpfProfileForm()/module-hrprofile.js).
router.get('/me', async (req, res) => {
  try {
    // Khối 0: employeeProfiles không qua GET /api/data chung (field nhạy cảm, xem đầu file) nên
    // hasModuleAccessServer() không tự mirror được — phải tự chặn ở đây. Đợt test chuyên sâu 9/2026
    // (PQ, mục Phân Quyền) phát hiện trước đây route này KHÔNG hề kiểm tra Khối 0 — tắt
    // moduleAccess.hrProfile cho 1 user vẫn không cản được họ gọi thẳng route này xem hồ sơ chính mình.
    if (!hasModuleAccessServer(req.freshUser, 'hrProfile')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập module này' });
    }
    const list = (await getAppDataValue('employeeProfiles')) || [];
    const profile = employeeProfile.findProfileByUsername(list, req.freshUser.username);
    if (!profile) return res.status(404).json({ error: 'Bạn chưa có Hồ Sơ Nhân Sự (có thể tài khoản chưa được liên kết với hồ sơ Onboarding)' });
    const selfVisibleFields = employeeProfile.sanitizeSelfVisibleFields(
      (await getAppDataValue('hrProfileSelfVisibleFields')) || []);
    res.json({ profile: employeeProfile.stripSelfHiddenFields(profile, selfVisibleFields), selfVisibleFields });
  } catch (err) { sendCatchError(res, err, 'GET /api/hr-profile/me'); }
});

// PATCH /api/hr-profile/me — tự sửa trường tự phục vụ (SELF_EDITABLE_FIELDS) — field đang bị ẩn
// (selfVisibleFields) cũng KHÔNG tự sửa được qua đường này (đối xứng đúng phần không xem được ở GET
// /me — phòng request tự soạn/DevTools sửa tay gửi kèm field đã bị ẩn khỏi UI).
router.patch('/me', async (req, res) => {
  try {
    if (!hasModuleAccessServer(req.freshUser, 'hrProfile')) {
      return res.status(403).json({ error: 'Bạn không có quyền truy cập module này' });
    }
    const selfVisibleFields = employeeProfile.sanitizeSelfVisibleFields(
      (await getAppDataValue('hrProfileSelfVisibleFields')) || []);
    const editableFields = employeeProfile.SELF_EDITABLE_FIELDS.filter(
      f => !employeeProfile.SENSITIVE_FIELDS.includes(f) || selfVisibleFields.includes(f));
    let updated;
    await withLockedAppDataValue('employeeProfiles', (list) => {
      const profile = employeeProfile.findProfileByUsername(list, req.freshUser.username);
      if (!profile) throw new HttpError(404, 'Bạn chưa có Hồ Sơ Nhân Sự');
      employeeProfile.applyProfileEdit(profile, req.body, editableFields, req.freshUser.username, req.freshUser.name);
      updated = profile;
      return list;
    });
    res.json({ ok: true, profile: employeeProfile.stripSelfHiddenFields(updated, selfVisibleFields), selfVisibleFields });
  } catch (err) { sendCatchError(res, err, 'PATCH /api/hr-profile/me'); }
});

// GET /api/hr-profile — danh sách nhẹ (HR/admin only) — dùng cho màn quản lý, không lộ field nhạy cảm.
router.get('/', async (req, res) => {
  try {
    if (!employeeProfile.canFullViewProfiles(req.freshUser)) return res.status(403).json({ error: 'Bạn không có quyền xem danh sách Hồ Sơ Nhân Sự' });
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
router.get('/position-options', requireProfileEdit, async (req, res) => {
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
    if (!employeeProfile.canEditProfiles(req.freshUser)) return res.status(403).json({ error: 'Chỉ HR/Admin mới gán chức vụ' });
    const positionKey = String(req.body?.positionKey || '').trim();
    if (!positionKey) return res.status(400).json({ error: 'Vui lòng chọn chức vụ từ Cơ Cấu Tổ Chức' });
    const effectiveDate = req.body?.effectiveDate ? String(req.body.effectiveDate).trim() : null;
    const note = req.body?.note;
    const fileUrl = req.body?.fileUrl;
    const fileName = req.body?.fileName;
    const orgChartVersions = (await getAppDataValue('orgChartVersions')) || [];
    const applied = orgChart.getAppliedVersion(orgChartVersions);
    let updated, syncTarget = null;
    await withLockedAppDataValue('employeeProfiles', (list) => {
      const profile = employeeProfile.findProfile(list, req.params.employeeCode);
      if (!profile) throw new HttpError(404, 'Không tìm thấy hồ sơ');
      const result = employeeProfile.applyPositionAssignment(profile, applied, positionKey, effectiveDate, req.freshUser.username, req.freshUser.name, note, fileUrl, fileName);
      updated = profile;
      if (profile.username) syncTarget = { username: profile.username, jobTitle: result.jobTitle, dept: result.dept, posType: result.posType };
      return list;
    });
    if (syncTarget) {
      await withLockedAppDataValue('users', (list) => (list || []).map(u =>
        u.username === syncTarget.username ? { ...u, jobTitle: syncTarget.jobTitle, dept: syncTarget.dept, ...(syncTarget.posType ? { posType: syncTarget.posType } : {}) } : u
      ));
    }
    logHrProfileAction(req, 'SET_POSITION', req.params.employeeCode, `Gán chức vụ cho hồ sơ [${req.params.employeeCode}]: ${updated.positionLabel || positionKey}`);
    res.json({ ok: true, profile: updated });
  } catch (err) { sendCatchError(res, err, `POST /api/hr-profile/by-code/${req.params.employeeCode}/set-position`); }
});

// GET /api/hr-profile/by-code/:employeeCode/history — "Lịch Sử Nhân Sự" gộp xuyên suốt hồ sơ: chức vụ
// (profile.positionHistory[]) + tạo mới/chỉnh sửa hồ sơ (profile.profileEditHistory[], 9/2026) + tái
// tuyển (profile.rehireHistory[]) + toàn bộ hợp đồng lao động của nhân viên này (mã hợp đồng ký MỚI/kích
// hoạt/thay thế/chấm dứt từ laborContracts[].history[] + các dòng "Bổ Sung Phụ Lục" từ amendments[]) —
// xem yêu cầu "muốn có lịch sử này xuyên suốt hồ sơ nhân sự" đã xác nhận với người dùng. Quyền: CẦN CẢ
// hrProfileManage LẪN hrContractManage — cố ý CHẶT hơn từng route riêng lẻ ở trên, vì dữ
// liệu hợp đồng gộp vào đây có LƯƠNG (trường vốn chỉ admin/hrContractManage được đọc, xem
// canViewLaborContract() ở lib/recordViewScope.js) — không nới lỏng biên giới đó chỉ vì gộp chung 1 màn.
router.get('/by-code/:employeeCode/history', async (req, res) => {
  try {
    const canFull = employeeProfile.canManageProfiles(req.freshUser) && canManageContracts(req.freshUser);
    if (!canFull) return res.status(403).json({ error: 'Cần đồng thời quyền Quản Lý Hồ Sơ Nhân Sự và Quản Lý Hợp Đồng Lao Động để xem Lịch Sử Nhân Sự đầy đủ' });
    const list = (await getAppDataValue('employeeProfiles')) || [];
    const profile = employeeProfile.findProfile(list, req.params.employeeCode);
    if (!profile) return res.status(404).json({ error: 'Không tìm thấy hồ sơ' });
    const events = [];
    for (const h of (profile.positionHistory || [])) {
      events.push({
        type: 'POSITION', time: h.createdAt, date: h.effectiveDate,
        title: h.oldPositionLabel ? `Đổi chức vụ: "${h.oldPositionLabel}" → "${h.newPositionLabel}"` : `Bổ nhiệm chức vụ: "${h.newPositionLabel}"`,
        detail: h.note || null, by: h.changedByName || h.changedBy,
        fileUrl: h.fileUrl || null, fileName: h.fileName || null
      });
    }
    for (const h of (profile.profileEditHistory || [])) {
      events.push({
        type: h.type === 'CREATE' ? 'PROFILE_CREATE' : 'PROFILE_EDIT', time: h.createdAt, date: vnDateOnly(h.createdAt),
        title: h.type === 'CREATE' ? 'Tạo mới hồ sơ nhân sự' : `Chỉnh sửa hồ sơ: ${(h.changedFields || []).join(', ')}`,
        detail: null, by: h.byName || h.by
      });
    }
    for (const h of (profile.rehireHistory || [])) {
      events.push({
        type: 'REHIRE', time: h.rehiredAt, date: h.newStartDate,
        title: `Tái tuyển — bắt đầu làm việc lại từ ${h.newStartDate}`,
        detail: null, by: h.rehiredByName || h.rehiredBy
      });
    }
    const contracts = (await getAllForCollection('laborContracts')).filter(c => c.employeeCode === profile.employeeCode);
    for (const c of contracts) {
      for (const h of (c.history || [])) {
        events.push({ type: 'CONTRACT', time: h.time, date: vnDateOnly(h.time), title: `Hợp đồng ${c.code}: ${h.detail || h.action}`, detail: null, by: h.byName || h.by });
      }
      for (const a of (c.amendments || [])) {
        events.push({
          type: 'CONTRACT_AMENDMENT', time: a.createdAt, date: a.effectiveDate,
          title: `Hợp đồng ${c.code} — Phụ lục: ${a.amendmentType}`,
          detail: [a.oldValue ? `Cũ: ${a.oldValue}` : null, a.newValue ? `Mới: ${a.newValue}` : null, a.note].filter(Boolean).join(' — ') || null,
          by: a.createdByName || a.createdBy,
          fileUrl: a.fileUrl || null, fileName: a.fileName || null
        });
      }
    }
    // Sắp mới nhất lên đầu — SO SÁNH THEO THỜI GIAN THỰC (parseVNDateTime), KHÔNG localeCompare() chuỗi
    // "HH:mm:ss d/M/yyyy" (định dạng nowVN() — so sánh chuỗi trực tiếp cho kết quả SAI, VD "9:00:00 5/1"
    // > "8:00:00 15/1" theo thứ tự chuỗi dù 15/1 diễn ra SAU 5/1).
    events.sort((x, y) => vnTime(y.time) - vnTime(x.time));
    // Ghi log TRUY CẬP (không chỉ ghi/sửa) — Lịch Sử Nhân Sự gộp cả lương/hợp đồng, mức nhạy cảm cao
    // nhất theo comment ở trên, người dùng yêu cầu có log để đối chiếu ai đã xem.
    logHrProfileAction(req, 'VIEW_HISTORY', req.params.employeeCode, `Xem Lịch Sử Nhân Sự đầy đủ [${req.params.employeeCode}]`);
    res.json({ events });
  } catch (err) { sendCatchError(res, err, `GET /api/hr-profile/by-code/${req.params.employeeCode}/history`); }
});

// GET/PUT /api/hr-profile/manager-field-config — cấu hình field nhạy cảm nào (subset SENSITIVE_FIELDS)
// được MỞ THÊM cho quản lý trực tiếp xem (9/2026, theo yêu cầu người dùng — "để tôi linh động cấu hình
// các trường thông tin nhân viên và quản lý trực tiếp được phép xem"). CHỈ hrProfileManage/admin cấu
// hình được (requireProfileManage — đây là cấu hình BẢO MẬT áp dụng CHUNG cho toàn bộ quản lý trực tiếp
// trong hệ thống, không rơi vào phạm vi 3 quyền chi tiết Tạo/Xem toàn bộ/Sửa 1 hồ sơ cụ thể).
router.get('/manager-field-config', requireProfileManage, async (req, res) => {
  try {
    const saved = (await getAppDataValue('hrProfileManagerVisibleFields')) || [];
    res.json({
      visibleFields: employeeProfile.sanitizeManagerVisibleFields(saved),
      availableFields: employeeProfile.SENSITIVE_FIELDS.map(f => ({ field: f, label: employeeProfile.SENSITIVE_FIELD_LABELS[f] || f }))
    });
  } catch (err) { sendCatchError(res, err, 'GET /api/hr-profile/manager-field-config'); }
});
router.put('/manager-field-config', requireProfileManage, async (req, res) => {
  try {
    const visibleFields = employeeProfile.sanitizeManagerVisibleFields(req.body?.visibleFields);
    await withLockedAppDataValue('hrProfileManagerVisibleFields', () => visibleFields);
    res.json({ ok: true, visibleFields });
  } catch (err) { sendCatchError(res, err, 'PUT /api/hr-profile/manager-field-config'); }
});

// GET/PUT /api/hr-profile/self-field-config — cấu hình field nào (SENSITIVE_FIELDS, nay đã mở rộng lên
// 15 trường) nhân viên được phép TỰ XEM trên hồ sơ CHÍNH MÌNH ("Hồ Sơ Của Tôi", 9/2026 theo yêu cầu
// người dùng — đối xứng manager-field-config ở trên nhưng áp dụng cho chính chủ thay vì quản lý trực
// tiếp). CHỈ hrProfileManage/admin cấu hình được (requireProfileManage — cùng lý do manager-field-config:
// cấu hình bảo mật áp dụng CHUNG cho toàn bộ nhân viên trong hệ thống). Fallback [] khi chưa cấu hình —
// CÙNG NGUYÊN TẮC manager-field-config (mặc định ẩn hết tới khi admin chủ động chọn), xem chú thích
// defaults.js::hrProfileSelfVisibleFields.
router.get('/self-field-config', requireProfileManage, async (req, res) => {
  try {
    const saved = (await getAppDataValue('hrProfileSelfVisibleFields')) || [];
    res.json({
      visibleFields: employeeProfile.sanitizeSelfVisibleFields(saved),
      availableFields: employeeProfile.SENSITIVE_FIELDS.map(f => ({ field: f, label: employeeProfile.SENSITIVE_FIELD_LABELS[f] || f }))
    });
  } catch (err) { sendCatchError(res, err, 'GET /api/hr-profile/self-field-config'); }
});
router.put('/self-field-config', requireProfileManage, async (req, res) => {
  try {
    const visibleFields = employeeProfile.sanitizeSelfVisibleFields(req.body?.visibleFields);
    await withLockedAppDataValue('hrProfileSelfVisibleFields', () => visibleFields);
    res.json({ ok: true, visibleFields });
  } catch (err) { sendCatchError(res, err, 'PUT /api/hr-profile/self-field-config'); }
});

// GET /api/hr-profile/reports — Báo Cáo Nhân Sự (9/2026, theo yêu cầu người dùng) — employeeProfiles/
// laborContracts bị chặn hẳn khỏi GET /api/reports chung (dữ liệu cực nhạy cảm, xem CLAUDE.md +
// routes/data.js) nên KHÔNG đi qua khuôn báo cáo module thường (module-baocaoquantri.js) — route riêng
// tại đây, tính THUẦN ở employeeProfile.computeHrReportSummary() (test được không cần HTTP). Quyền: CẦN
// CẢ hrProfileManage LẪN hrContractManage — CÙNG mức chặt như GET .../history (vẫn lộ số
// liệu lương qua mục tăng lương). rate-limit riêng (cùng khuôn routes/reports.js) — phòng truy vấn quá
// nhiều dội liên tục.
const hrReportsRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Bạn đang truy vấn báo cáo quá nhiều, vui lòng thử lại sau ít phút.' },
  keyGenerator: (req) => req.freshUser?.username || req.ip
});
router.get('/reports', hrReportsRateLimiter, async (req, res) => {
  try {
    const canFull = employeeProfile.canManageProfiles(req.freshUser) && canManageContracts(req.freshUser);
    if (!canFull) return res.status(403).json({ error: 'Cần đồng thời quyền Quản Lý Hồ Sơ Nhân Sự và Quản Lý Hợp Đồng Lao Động để xem Báo Cáo Nhân Sự' });
    const from = req.query?.from ? String(req.query.from).trim() : '';
    const to = req.query?.to ? String(req.query.to).trim() : '';
    const contractStatus = req.query?.contractStatus ? String(req.query.contractStatus).trim() : '';
    const [profiles, contracts] = await Promise.all([
      getAppDataValue('employeeProfiles').then(v => v || []),
      getAllForCollection('laborContracts')
    ]);
    const summary = employeeProfile.computeHrReportSummary(profiles, contracts, { from, to, contractStatus });
    logHrProfileAction(req, 'VIEW_REPORT', '', 'Xem Báo Cáo Nhân Sự');
    res.json(summary);
  } catch (err) { sendCatchError(res, err, 'GET /api/hr-profile/reports'); }
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
    const viewable = employeeProfile.getProfileForViewer(profile, req.freshUser, appData.users || [], appData.hrProfileManagerVisibleFields);
    if (!viewable) return res.status(404).json({ error: 'Không tìm thấy hồ sơ' });
    const viewMode = employeeProfile.canViewFullProfile(req.freshUser, profile) ? 'FULL' : 'LIMITED';
    res.json({ profile: viewable, viewMode, managerVisibleFields: employeeProfile.sanitizeManagerVisibleFields(appData.hrProfileManagerVisibleFields) });
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
    const viewable = employeeProfile.getProfileForViewer(profile, req.freshUser, appData.users || [], appData.hrProfileManagerVisibleFields);
    if (!viewable) return res.status(404).json({ error: 'Không tìm thấy hồ sơ' });
    const viewMode = employeeProfile.canViewFullProfile(req.freshUser, profile) ? 'FULL' : 'LIMITED';
    res.json({ profile: viewable, viewMode, managerVisibleFields: employeeProfile.sanitizeManagerVisibleFields(appData.hrProfileManagerVisibleFields) });
  } catch (err) { sendCatchError(res, err, `GET /api/hr-profile/by-username/${req.params.username}`); }
});

// PATCH /api/hr-profile/by-code/:employeeCode — HR/admin sửa TOÀN BỘ trường (kể cả HR_ONLY_EDITABLE_FIELDS).
router.patch('/by-code/:employeeCode', async (req, res) => {
  try {
    if (!employeeProfile.canEditProfiles(req.freshUser)) return res.status(403).json({ error: 'Chỉ HR/Admin mới sửa được hồ sơ người khác' });
    let updated;
    await withLockedAppDataValue('employeeProfiles', (list) => {
      const profile = employeeProfile.findProfile(list, req.params.employeeCode);
      if (!profile) throw new HttpError(404, 'Không tìm thấy hồ sơ');
      const allowed = [...employeeProfile.SELF_EDITABLE_FIELDS, ...employeeProfile.HR_ONLY_EDITABLE_FIELDS];
      employeeProfile.applyProfileEdit(profile, req.body, allowed, req.freshUser.username, req.freshUser.name);
      updated = profile;
      return list;
    });
    logHrProfileAction(req, 'EDIT', req.params.employeeCode, `Sửa hồ sơ [${req.params.employeeCode}]`);
    res.json({ ok: true, profile: updated });
  } catch (err) { sendCatchError(res, err, `PATCH /api/hr-profile/by-code/${req.params.employeeCode}`); }
});

// PATCH /api/hr-profile/by-code/:employeeCode/status — HR/admin đổi tay ACTIVE<->ON_LEAVE.
router.patch('/by-code/:employeeCode/status', async (req, res) => {
  try {
    if (!employeeProfile.canEditProfiles(req.freshUser)) return res.status(403).json({ error: 'Chỉ HR/Admin mới đổi trạng thái hồ sơ' });
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
    logHrProfileAction(req, 'STATUS_CHANGE', req.params.employeeCode, `Đổi trạng thái hồ sơ [${req.params.employeeCode}] -> ${updated.status}`);
    res.json({ ok: true, profile: updated });
  } catch (err) { sendCatchError(res, err, `PATCH /api/hr-profile/by-code/${req.params.employeeCode}/status`); }
});

// POST /api/hr-profile/by-code/:employeeCode/link-account — HR/admin liên kết hồ sơ (đang khoá theo
// employeeCode) với 1 tài khoản VPDT thật đã tồn tại (thường gọi ngay sau khi IT hoàn thành task "Tạo
// email công ty & tài khoản VPDT" ở quy trình Onboarding — xem đầu file lib/employeeProfile.js).
router.post('/by-code/:employeeCode/link-account', async (req, res) => {
  try {
    if (!employeeProfile.canEditProfiles(req.freshUser)) return res.status(403).json({ error: 'Chỉ HR/Admin mới liên kết tài khoản VPDT' });
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
    logHrProfileAction(req, 'LINK_ACCOUNT', req.params.employeeCode, `Liên kết hồ sơ [${req.params.employeeCode}] với tài khoản "${username}"`);
    res.json({ ok: true, profile: updated });
  } catch (err) { sendCatchError(res, err, `POST /api/hr-profile/by-code/${req.params.employeeCode}/link-account`); }
});

// POST /api/hr-profile — HR/admin tạo tay 1 hồ sơ MỚI (nhân viên cũ đã đang làm việc, chưa từng qua
// Onboarding nên chưa có hồ sơ) — xem lib/employeeProfile.js::createManualProfile(). payload.positionKey
// (tuỳ chọn) — chức vụ BAN ĐẦU chọn ngay từ Cơ Cấu Tổ Chức lúc tạo, áp dụng NGAY trong cùng giao dịch
// (chính là lần đầu tiên của positionHistory[], không cần thao tác riêng "gán chức vụ" ngay sau đó).
router.post('/', requireProfileCreate, async (req, res) => {
  try {
    const username = req.body?.username ? String(req.body.username).trim() : null;
    const positionKey = req.body?.positionKey ? String(req.body.positionKey).trim() : null;
    const appData = await getAllAppData();
    assertActiveAccountIfGiven(username, appData.users || []);
    const applied = positionKey ? orgChart.getAppliedVersion((await getAppDataValue('orgChartVersions')) || []) : null;
    let created, syncTarget = null;
    await withLockedAppDataValue('employeeProfiles', (list) => {
      created = employeeProfile.createManualProfile(list, req.body, req.freshUser.username, req.freshUser.name);
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
    logHrProfileAction(req, 'CREATE', created.employeeCode, `Tạo mới hồ sơ nhân sự [${created.employeeCode}]`);
    res.json({ ok: true, profile: created });
  } catch (err) { sendCatchError(res, err, 'POST /api/hr-profile'); }
});

// GET /api/hr-profile/search-inactive?nationalId=...&dateOfBirth=... — "Kiểm Tra Nhân Sự Cũ" (9/2026,
// theo yêu cầu người dùng): tìm hồ sơ ĐÃ NGHỈ VIỆC theo CCCD/Ngày sinh trước khi HR tạo hồ sơ/Onboarding
// mới, để phát hiện đúng trường hợp TÁI TUYỂN thay vì tạo trùng 1 người thành 2 hồ sơ khác nhau. Trả về
// field TỐI THIỂU đủ để HR nhận diện đúng người (không phải toàn bộ hồ sơ nhạy cảm) — cùng mức thông tin
// với GET /employee-directory ở trên.
router.get('/search-inactive', requireProfileCreateOrEdit, async (req, res) => {
  try {
    const nationalId = req.query?.nationalId ? String(req.query.nationalId).trim() : '';
    const dateOfBirth = req.query?.dateOfBirth ? String(req.query.dateOfBirth).trim() : '';
    if (!nationalId && !dateOfBirth) return res.json({ results: [] });
    const appData = await getAllAppData();
    const matches = employeeProfile.searchInactiveProfilesForRehire(appData.employeeProfiles || [], nationalId, dateOfBirth);
    // resolveProfileDisplayName() cần cả hrProcesses để suy tên khi hồ sơ CHƯA liên kết username — nhưng
    // hồ sơ INACTIVE (đường DUY NHẤT tới trạng thái này là Offboarding hoàn tất, luôn tra theo
    // employeeUsername — xem applyProcessCompletion()) LUÔN đã có username từ trước, nên chỉ cần tra
    // users là đủ, không cần đọc thêm hrProcesses (bảng SQL riêng, tránh 1 round-trip không cần thiết).
    const results = matches.slice(0, 20).map(p => ({
      employeeCode: p.employeeCode,
      fullName: employeeProfile.resolveProfileDisplayName(p, appData.users || [], []),
      dept: p.dept, jobTitle: p.jobTitle, positionLabel: p.positionLabel,
      dateOfBirth: p.dateOfBirth, updatedAt: p.updatedAt
    }));
    res.json({ results });
  } catch (err) { sendCatchError(res, err, 'GET /api/hr-profile/search-inactive'); }
});

// POST /api/hr-profile/by-code/:employeeCode/rehire — xác nhận Tái Tuyển: kích hoạt lại ĐÚNG hồ sơ đã
// tìm thấy ở trên (giữ nguyên Mã NV + toàn bộ lịch sử/hợp đồng cũ, chỉ đổi status + ghi 1 dòng lịch sử
// tái tuyển — xem lib/employeeProfile.js::reactivateForRehire()). Body: { newStartDate }.
router.post('/by-code/:employeeCode/rehire', requireProfileCreateOrEdit, async (req, res) => {
  try {
    let updated;
    await withLockedAppDataValue('employeeProfiles', (list) => {
      updated = employeeProfile.reactivateForRehire(list, req.params.employeeCode, req.body?.newStartDate, req.freshUser.username, req.freshUser.name);
      return list;
    });
    logHrProfileAction(req, 'REHIRE', req.params.employeeCode, `Tái tuyển hồ sơ [${req.params.employeeCode}]`);
    res.json({ ok: true, profile: updated });
  } catch (err) { sendCatchError(res, err, `POST /api/hr-profile/by-code/${req.params.employeeCode}/rehire`); }
});

// GET /api/hr-profile/import-template — mẫu Excel để HR điền hàng loạt hồ sơ nhân viên cũ.
router.get('/import-template', requireProfileCreate, async (req, res) => {
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
router.post('/parse-import', uploadRateLimiter, requireProfileCreate, (req, res) => {
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
router.post('/bulk-import', requireProfileCreate, async (req, res) => {
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
          const created = employeeProfile.createManualProfile(list, row, req.freshUser.username, req.freshUser.name);
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
router.get('/export-xlsx', requireProfileFullView, async (req, res) => {
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
