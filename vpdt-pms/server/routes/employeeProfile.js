// routes/employeeProfile.js — Hồ Sơ Nhân Sự (Phần C, đợt 1/4 module Nhân Sự — sau Cơ Cấu Tổ Chức/
// Onboarding-Offboarding đã build). Route RIÊNG (không qua GET /api/data chung) vì cần strip field nhạy
// cảm THEO TỪNG VAI TRÒ NGƯỜI XEM (xem lib/employeeProfile.js::getProfileForViewer()) — routes/data.js
// chỉ lọc theo ITEM (ẩn/hiện cả bản ghi), không strip field bên trong 1 bản ghi được phép xem.
const express = require('express');
const { requireAuth, blockIfMustChangePassword } = require('../lib/auth');
const { getAppDataValue, getAllAppData, withLockedAppDataValue } = require('../lib/appData');
const { HttpError } = require('../lib/httpErrors');
const { sendCatchError } = require('../lib/errorResponse');
const employeeProfile = require('../lib/employeeProfile');

const router = express.Router();
router.use(requireAuth, blockIfMustChangePassword);

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

module.exports = router;
