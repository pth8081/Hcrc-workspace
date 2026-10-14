// server/tests/test-meeting-license-no-approver-block.js
//
// Regression test cho LỖ HỔNG ĐÃ VÁ (11/2026, theo yêu cầu người dùng, rà soát "quy trình phê duyệt
// thiếu/khoá người duyệt" — mở rộng sang 2 module KHÔNG đi qua lib/workflowEngine.js::findMissingApproverStep()):
//   - Phòng Họp (meetings): duyệt bằng quyền PHẲNG meetingApprove + CỘNG THÊM cấu hình theo phòng ban
//     (meetingDeptWorkflows), xem canDecideMeeting()/hasAnyValidMeetingApprover() (lib/recordActions.js).
//   - Giấy Phép (licenses): duyệt bằng quyền PHẲNG licenseApprove, xem canApproveLicense()/
//     hasAnyValidLicenseApprover() (lib/recordActions.js).
// TRƯỚC ĐÂY cả 2 module này KHÔNG có lớp chặn nào — nếu chưa từng có ai được cấp quyền duyệt tương ứng,
// hồ sơ vẫn tạo/tải lên "thành công" rồi treo PENDING vĩnh viễn, không ai duyệt được, admin không biết.
//
//   PHẦN A — Phòng Họp:
//     1. CHƯA có ai giữ meetingApprove, CHƯA gán riêng cho phòng ban -> chặn 409, admin được thông báo.
//     2. ĐÃ gán riêng 1 người cho phòng ban (meetingDeptWorkflows) dù không ai giữ meetingApprove toàn
//        công ty -> KHÔNG chặn, đăng ký thành công bình thường (đối chứng).
//     3. Người giữ meetingApprove đã bị KHOÁ TÀI KHOẢN (active:false), không ai khác -> vẫn chặn 409.
//     4. Có người ĐANG giữ meetingApprove (active) -> không chặn (đối chứng).
//
//   PHẦN B — Giấy Phép:
//     5. CHƯA có ai giữ licenseApprove -> chặn 409, admin được thông báo.
//     6. Có người giữ licenseApprove nhưng đã KHOÁ TÀI KHOẢN -> vẫn chặn 409.
//     7. Có người ĐANG giữ licenseApprove (active) -> tải lên thành công (đối chứng).
//
// Chạy: node server/tests/test-meeting-license-no-approver-block.js
'use strict';
const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let passed = 0, failed = 0;
function check(label, cond, detail) {
  if (cond) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ ${label}${detail !== undefined ? '\n     ' + JSON.stringify(detail) : ''}`); failed++; }
}

const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
const NV_PHONGA = { username: 'nv.phonga', name: 'Nhân Viên Phòng A', dept: 'Phòng A', perms: { meetingBook: true, licenseCreate: true }, active: true };

const notifications = [];
stubModule('lib/notifications', {
  notifyUsers: async (usernames, type, title, message, linkTo) => { notifications.push({ usernames, type, title, message, linkTo }); return []; }
});

let RECORDS = {};
let APP_DATA = {};
function resetAll() {
  RECORDS = { meetings: [], licenses: [] };
  APP_DATA = {
    users: [ADMIN, NV_PHONGA],
    depts: ['Phòng A'], stores: [],
    meetingRooms: [{ name: 'Phòng Họp 1' }],
    meetingDeptWorkflows: {}
  };
}
resetAll();

stubModule('lib/appData', {
  getAllAppData: async () => JSON.parse(JSON.stringify(APP_DATA)),
  withLockedAppDataValue: async (key, fn) => fn([])
});
stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['meetings', 'licenses']),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  getTrashItems: async () => [],
  createForCollection: async (c, builderFn) => { const record = await builderFn((RECORDS[c] || []).slice()); RECORDS[c].push(record); return record; },
  createForCollectionSerialized: async (c, lockKey, builderFn) => { const record = await builderFn((RECORDS[c] || []).slice()); RECORDS[c].push(record); return record; },
  withAppLock: async (key, fn) => fn()
});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
stubModule('lib/uploadedFiles', {
  assertPayloadFileUrlsOwnedByUser: async () => {},
  recordUploadedFile: async () => {},
  getFileUrlOwners: async () => new Map(),
  collectFileUrlsDeep: () => {}
});
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const username = req.headers['x-test-user'];
    const fresh = APP_DATA.users.find((u) => u.username === username);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = APP_DATA.users;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const createRoutes = require('../routes/create');

async function api(server, method, urlPath, body, asUser) {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json', 'x-test-user': asUser.username },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null; try { payload = await res.json(); } catch (e) {}
  return { status: res.status, body: payload };
}

function meetingPayload() {
  return { room: 'Phòng Họp 1', startTime: '2026-12-01T09:00:00', endTime: '2026-12-01T10:00:00', purpose: 'Họp demo', attendees: 5, customData: {} };
}
function licensePayload() {
  return {
    companyName: 'Công ty Demo', locationName: 'Trụ sở chính', licenseType: 'Giấy phép kinh doanh',
    licenseNumber: 'GP-001', issuingAuthority: 'Sở KHĐT', operatingStatus: 'ACTIVE',
    issueDate: '2026-01-01', expiryDate: '2030-01-01', fileUrl: '/uploads/giayphep.pdf'
  };
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  const server = http.createServer(app);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });

  try {
    console.log('\n== Phần A: Phòng Họp (meetings) ==');

    resetAll(); notifications.length = 0;
    const r1 = await api(server, 'POST', '/api/create/meetings', meetingPayload(), NV_PHONGA);
    check('[1] Chưa ai giữ meetingApprove, chưa gán riêng phòng ban -> chặn 409', r1.status === 409 && RECORDS.meetings.length === 0, r1.body);
    check('[1] Thông báo nêu đúng tên phòng ban', /Phòng A/.test(r1.body?.error || ''), r1.body);
    check('[1] Admin được thông báo', notifications.length === 1 && notifications[0].usernames.includes('admin'), notifications);

    resetAll(); notifications.length = 0;
    const NGUOI_DUYET_RIENG = { username: 'nguoiduyet.phonga', name: 'Người Duyệt Phòng A', dept: 'Phòng A', perms: {}, active: true };
    APP_DATA.users.push(NGUOI_DUYET_RIENG);
    APP_DATA.meetingDeptWorkflows['Phòng A'] = { workflowId: 'WF_1STEP', approvers: { 1: [NGUOI_DUYET_RIENG.username] } };
    const r2 = await api(server, 'POST', '/api/create/meetings', meetingPayload(), NV_PHONGA);
    check('[2 — đối chứng] Đã gán riêng người duyệt cho phòng ban -> đăng ký thành công, không chặn', r2.status === 200 && RECORDS.meetings.length === 1, r2.body);

    resetAll(); notifications.length = 0;
    const TP_NGHIVIEC = { username: 'tp.old', name: 'Trưởng Phòng Cũ', dept: 'Phòng A', perms: { meetingApprove: true }, active: false };
    APP_DATA.users.push(TP_NGHIVIEC);
    const r3 = await api(server, 'POST', '/api/create/meetings', meetingPayload(), NV_PHONGA);
    check('[3] Người giữ meetingApprove đã bị khoá tài khoản -> vẫn chặn 409', r3.status === 409 && RECORDS.meetings.length === 0, r3.body);

    resetAll(); notifications.length = 0;
    const TP_DANGLAM = { username: 'tp.active', name: 'Trưởng Phòng', dept: 'Phòng Khác', perms: { meetingApprove: true }, active: true };
    APP_DATA.users.push(TP_DANGLAM);
    const r4 = await api(server, 'POST', '/api/create/meetings', meetingPayload(), NV_PHONGA);
    check('[4 — đối chứng] Có người ĐANG giữ meetingApprove (toàn công ty) -> không chặn', r4.status === 200 && RECORDS.meetings.length === 1, r4.body);

    console.log('\n== Phần B: Giấy Phép (licenses) ==');

    resetAll(); notifications.length = 0;
    const r5 = await api(server, 'POST', '/api/create/licenses', licensePayload(), NV_PHONGA);
    check('[5] Chưa ai giữ licenseApprove -> chặn 409', r5.status === 409 && RECORDS.licenses.length === 0, r5.body);
    check('[5] Admin được thông báo', notifications.length === 1, notifications);

    resetAll(); notifications.length = 0;
    const DUYET_GP_NGHIVIEC = { username: 'duyetgp.old', name: 'Người Duyệt GP Cũ', dept: 'Phòng Khác', perms: { licenseApprove: true }, active: false };
    APP_DATA.users.push(DUYET_GP_NGHIVIEC);
    const r6 = await api(server, 'POST', '/api/create/licenses', licensePayload(), NV_PHONGA);
    check('[6] Người giữ licenseApprove đã bị khoá tài khoản -> vẫn chặn 409', r6.status === 409 && RECORDS.licenses.length === 0, r6.body);

    resetAll(); notifications.length = 0;
    const DUYET_GP_DANGLAM = { username: 'duyetgp.active', name: 'Người Duyệt GP', dept: 'Phòng Khác', perms: { licenseApprove: true }, active: true };
    APP_DATA.users.push(DUYET_GP_DANGLAM);
    const r7 = await api(server, 'POST', '/api/create/licenses', licensePayload(), NV_PHONGA);
    check('[7 — đối chứng] Có người ĐANG giữ licenseApprove -> tải lên thành công', r7.status === 200 && RECORDS.licenses.length === 1, r7.body);
    check('[7] Không gửi thông báo admin khi mọi thứ hợp lệ', notifications.length === 0, notifications);
  } finally {
    server.close();
  }

  console.log(failed ? `\n${failed} FAILED` : '\nAll passed');
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
