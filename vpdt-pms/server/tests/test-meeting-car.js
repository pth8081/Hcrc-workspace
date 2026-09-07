// tests/test-meeting-car.js — Regression suite for "Hành Chính > Đặt Phòng Họp" (DB key `meeting`) and
// "Đăng Ký Xe" (DB key `car`).
//
// Same approach as test-minutes.js (read that file's header for the full rationale): no real SQL Server
// is available, so instead of a dumb no-op fetch stub, a tiny local http.createServer implements the
// handful of routes these 2 modules call — but backed by the REAL server logic modules
// `../lib/createValidation.js` (validateAndPrepareCreate + findMeetingConflict — the exact functions
// routes/create.js and routes/meetingActions.js call) and `../lib/workflowEngine.js`
// (applyWorkflowAction — the exact function routes/workflow.js calls for carRegs approve/reject,
// including findCarPlateConflict double-booking detection). Only the SQL storage layer is swapped for
// plain in-memory arrays, and only HTTP auth is swapped for a Node-side "activeServerUser" the test sets.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { validateAndPrepareCreate, findMeetingConflict, CreateError } = require('../lib/createValidation');
const { applyWorkflowAction, WorkflowError } = require('../lib/workflowEngine');
const { HttpError } = require('../lib/httpErrors');
const recordActions = require('../lib/recordActions');
const { canViewCarReg } = require('../lib/recordViewScope');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8972;

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

// ===================== In-memory "server" state =====================
const store = { meetings: [], carRegs: [], users: [] };
let activeServerUser = null;

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let chunks = '';
    req.on('data', (c) => { chunks += c; });
    req.on('end', () => { try { resolve(chunks ? JSON.parse(chunks) : {}); } catch { resolve({}); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(INDEX_HTML_PATH, 'utf8'));
    return;
  }

  // Tài nguyên JS ngoài index.html — public/index.html giờ tải JS qua nhiều
  // <script src="/js/...">  thay vì 1 khối inline (xem VERSION.md "Tách JS ra file ngoài") — phục vụ
  // tĩnh trực tiếp từ public/js/, khớp đúng cách server.js thật serve (express.static(public/)).
  if (req.method === 'GET' && url.pathname.startsWith('/js/')) {
    const PUBLIC_DIR = path.join(__dirname, '..', 'public');
    const filePath = path.join(PUBLIC_DIR, decodeURIComponent(url.pathname));
    if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    return fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found: ' + url.pathname); }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      res.end(data);
    });
  }

  // POST /api/create/meetings | /api/create/carRegs — same generic module routes/create.js dispatches to.
  const createMatch = url.pathname.match(/^\/api\/create\/(meetings|carRegs)$/);
  if (req.method === 'POST' && createMatch) {
    const moduleKey = createMatch[1];
    const body = await readBody(req);
    const collection = moduleKey === 'meetings' ? store.meetings : store.carRegs;
    try {
      const item = validateAndPrepareCreate(moduleKey, body, activeServerUser, collection, {});
      collection.push(item);
      return sendJson(res, 200, { ok: true, item });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // POST /api/meetings/:id/approve|cancel — mirrors routes/meetingActions.js (flat perm, not the
  // step-based workflow engine — meetings have no multi-step workflow).
  const meetingActionMatch = url.pathname.match(/^\/api\/meetings\/(\d+)\/(approve|cancel)$/);
  if (req.method === 'POST' && meetingActionMatch) {
    const id = Number(meetingActionMatch[1]);
    const action = meetingActionMatch[2];
    const item = store.meetings.find((m) => m.id === id);
    if (!item) return sendJson(res, 404, { error: 'Không tìm thấy hồ sơ' });
    const perm = action === 'approve' ? 'meetingApprove' : 'meetingCancel';
    const hasPerm = !!(activeServerUser.perms?.admin || activeServerUser.perms?.[perm]);
    if (action === 'approve' && !hasPerm) return sendJson(res, 403, { error: 'Bạn không có quyền thực hiện thao tác này' });
    if (action === 'cancel' && !hasPerm && item.creator !== activeServerUser.username) {
      return sendJson(res, 403, { error: 'Bạn chỉ có thể huỷ lịch do chính mình đặt' });
    }
    if (action === 'approve') {
      if (item.status !== 'PENDING') return sendJson(res, 409, { error: 'Lịch này không còn ở trạng thái chờ duyệt (có thể đã được xử lý ở nơi khác)' });
      const conflict = findMeetingConflict(store.meetings.filter((m) => m.id !== item.id), item.room, item.startTime, item.endTime);
      if (conflict) return sendJson(res, 409, { error: `Phòng "${item.room}" đã có lịch trùng khung giờ này (${conflict.code})` });
      item.status = 'APPROVED';
    } else {
      if (item.status === 'CANCELLED') return sendJson(res, 409, { error: 'Lịch này đã bị huỷ trước đó' });
      item.status = 'CANCELLED';
    }
    return sendJson(res, 200, { ok: true, item });
  }

  // POST /api/workflow/carRegs/:id/approve|reject|request-changes — the exact engine routes/workflow.js
  // calls. "request-changes" ("Bổ Sung") added alongside approve/reject (xem lib/workflowEngine.js
  // MODULE_CONFIGS.carRegs.supportsRequestChanges).
  const workflowMatch = url.pathname.match(/^\/api\/workflow\/carRegs\/(\d+)\/(approve|reject|request-changes)$/);
  if (req.method === 'POST' && workflowMatch) {
    const id = Number(workflowMatch[1]);
    const rawAction = workflowMatch[2];
    const actionMap = { approve: 'APPROVE', reject: 'REJECT', 'request-changes': 'REQUEST_CHANGES' };
    const body = await readBody(req);
    const item = store.carRegs.find((c) => c.id === id);
    if (!item) return sendJson(res, 404, { error: 'Không tìm thấy hồ sơ' });
    try {
      const outcome = applyWorkflowAction({
        moduleKey: 'carRegs', item, action: actionMap[rawAction],
        user: activeServerUser, comment: body.comment, extraFields: body.extraFields,
        // Dùng ĐÚNG carDeptWorkflows đã seed (không hardcode {} như trước) — cần thiết để test được các
        // approver KHÔNG PHẢI admin (canApproveStep chỉ cho qua nếu username có trong approvers[bước],
        // admin luôn bypass nên trước đây hardcode {} vẫn "vô tình" work cho mọi test dùng adminUser).
        appData: { carDeptWorkflows: store.carDeptWorkflows || {}, workflows: store.workflows || [] },
        existingCollection: store.carRegs, users: store.users
      });
      return sendJson(res, 200, { ok: true, item: outcome.item, transition: outcome.transition });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // POST /api/records/carRegs/:id/confirm-driver — mirrors routes/records.js.
  const confirmDriverMatch = url.pathname.match(/^\/api\/records\/carRegs\/(\d+)\/confirm-driver$/);
  if (req.method === 'POST' && confirmDriverMatch) {
    const id = Number(confirmDriverMatch[1]);
    const item = store.carRegs.find((c) => c.id === id);
    if (!item) return sendJson(res, 404, { error: 'Không tìm thấy hồ sơ' });
    try {
      const result = recordActions.confirmCarDriverAssignment(activeServerUser, item);
      return sendJson(res, 200, { ok: true, item: result });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // POST /api/records/carRegs/:id/cancel — Fix 4 (đợt rà soát nghiệp vụ) "Hủy chuyến" sau khi đã duyệt —
  // mirrors routes/records.js POST /api/records/carRegs/:id/cancel.
  const cancelCarMatch = url.pathname.match(/^\/api\/records\/carRegs\/(\d+)\/cancel$/);
  if (req.method === 'POST' && cancelCarMatch) {
    const id = Number(cancelCarMatch[1]);
    const body = await readBody(req);
    const item = store.carRegs.find((c) => c.id === id);
    if (!item) return sendJson(res, 404, { error: 'Không tìm thấy hồ sơ' });
    try {
      const result = recordActions.cancelCarReg(activeServerUser, item, body);
      return sendJson(res, 200, { ok: true, item: result });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // POST /api/records/carRegs/:id/reassign — Fix 4 "Đổi tài xế-xe" sau khi đã duyệt — mirrors
  // routes/records.js POST /api/records/carRegs/:id/reassign (đọc TOÀN BỘ store.carRegs để tái kiểm tra
  // trùng biển số, mirror đúng route thật đọc existingCarRegs trước khi khoá bản ghi).
  const reassignCarMatch = url.pathname.match(/^\/api\/records\/carRegs\/(\d+)\/reassign$/);
  if (req.method === 'POST' && reassignCarMatch) {
    const id = Number(reassignCarMatch[1]);
    const body = await readBody(req);
    const item = store.carRegs.find((c) => c.id === id);
    if (!item) return sendJson(res, 404, { error: 'Không tìm thấy hồ sơ' });
    try {
      const result = recordActions.reassignCarDispatch(activeServerUser, item, body, store.carRegs, store.users);
      return sendJson(res, 200, { ok: true, item: result });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // POST /api/records/carRegs/:id/update|submit — "Bổ Sung": sửa lại NHÁP (sau REQUEST_CHANGES) + gửi
  // lại, xem lib/recordActions.js editCarRegDraft()/submitCarRegDraft() — mirrors routes/records.js.
  const carDraftMatch = url.pathname.match(/^\/api\/records\/carRegs\/(\d+)\/(update|submit)$/);
  if (req.method === 'POST' && carDraftMatch) {
    const id = Number(carDraftMatch[1]);
    const action = carDraftMatch[2];
    const body = await readBody(req);
    const item = store.carRegs.find((c) => c.id === id);
    if (!item) return sendJson(res, 404, { error: 'Không tìm thấy hồ sơ' });
    try {
      const result = action === 'update'
        ? recordActions.editCarRegDraft(body, activeServerUser, item)
        : recordActions.submitCarRegDraft(activeServerUser, item);
      return sendJson(res, 200, { ok: true, item: result });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  sendJson(res, 200, {});
});

// ===================== Fixtures =====================
const bookerUser = {
  username: 'nv_kd1', name: 'Lê Thị Kinh Doanh', dept: 'Phòng Kinh Doanh', role: 'STAFF',
  phone: '0933333333', email: 'kd1@company.com', jobTitle: 'Nhân viên',
  active: true, perms: { meetingBookScope: { depts: ['Phòng Kinh Doanh'] }, carCreate: { depts: ['Phòng Kinh Doanh'] } }
};
const roomManagerUser = {
  username: 'qlph1', name: 'Phạm Quản Lý Phòng Họp', dept: 'Phòng Hành Chính', role: 'STAFF',
  phone: '0944444444', email: 'qlph@company.com', jobTitle: 'Quản lý phòng họp',
  active: true, perms: { meetingApprove: true, meetingCancel: true }
};
const adminUser = {
  username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', role: 'ADMIN',
  phone: '0955555555', email: 'admin@company.com', jobTitle: 'Admin',
  // totpEnabled:true — admin bắt buộc xác thực 2 lớp (xem lib/totp.js/proceedAfterAuth() ở index.html);
  // thiếu field này khiến loginAs() (gọi thẳng proceedAfterAuth()) bị chặn ở màn bắt buộc thiết lập TOTP.
  active: true, perms: { admin: true }, totpEnabled: true
};
// isDriver:true — đánh dấu để populateCarDriversDatalist() VÀ lưới "Lịch Xe" (renderCarScheduleCalendar(),
// module-dangkyxe.js) đều lọc ra đúng 2 tài khoản này (khớp DB.users.filter(u => u.active !== false &&
// u.isDriver) — cùng 1 nguồn dữ liệu duy nhất cho cả 2 nơi).
const driverUser = {
  username: 'lx1', name: 'Nguyễn Văn Tài', dept: 'Phòng Hành Chính', role: 'STAFF',
  phone: '0966666666', email: 'lx1@company.com', jobTitle: 'Lái xe',
  active: true, perms: {}, isDriver: true
};
const driverUser2 = {
  username: 'lx2', name: 'Trần Văn Lái', dept: 'Phòng Hành Chính', role: 'STAFF',
  phone: '0977777777', email: 'lx2@company.com', jobTitle: 'Lái xe',
  active: true, perms: {}, isDriver: true
};
// carDispatch ("Người Điều Hành Xe", Phase 3) — 2 tài khoản đều là approver bước 1 hợp lệ ở đúng phòng
// ban của phiếu họ sẽ duyệt (xem carDeptWorkflows trong seedDB bên dưới), CHỈ khác nhau ở carDispatch:
// noDispatchApproverUser không có -> vẫn duyệt/từ chối được nhưng KHÔNG được đụng tới mục "Phần Dành
// Cho Phòng Hành Chính"; dispatchApproverUser có -> vừa duyệt vừa gán được lái xe/loại xe/BKS.
const noDispatchApproverUser = {
  username: 'qlxe_nd', name: 'Nguyễn Không Điều Hành', dept: 'Phòng Hành Chính', role: 'STAFF',
  phone: '0988888881', email: 'qlxe_nd@company.com', jobTitle: 'Nhân viên',
  active: true, perms: { carDispatch: false }
};
const dispatchApproverUser = {
  username: 'qlxe_dp', name: 'Trần Điều Hành Xe', dept: 'Phòng Hành Chính', role: 'STAFF',
  phone: '0988888882', email: 'qlxe_dp@company.com', jobTitle: 'Người điều hành xe',
  active: true, perms: { carDispatch: true }
};

const ROOM = 'Phòng Họp Lớn A (Tầng 3 - Sức chứa 50 người)';

const seedDB = {
  depts: ['Phòng Kinh Doanh', 'Phòng Hành Chính', 'Ban Giám Đốc'],
  cats: [], stores: [],
  jobTitles: ['Nhân viên', 'Quản lý phòng họp', 'Admin'],
  submissionTypes: [], contractTypes: [],
  carTypes: ['Xe 4 chỗ', 'Xe 7 chỗ', 'Xe 16 chỗ'],
  // carPurposes/meetingRooms: đợt audit "form-fields-6" chuyển 2 danh sách này từ hằng số/hardcode
  // <option> sang dữ liệu DB.* — mock seed đúng khuôn defaults.js để không đổi hành vi các test bên dưới.
  carPurposes: [
    { key: 'Công tác', label: 'Công tác (đính kèm QĐ, KH)' },
    { key: 'Vận chuyển tài sản/hàng hóa', label: 'Vận chuyển tài sản/hàng hóa (đính kèm DS, KH)' },
    { key: 'Ngoại giao, đưa đón khách', label: 'Ngoại giao, đưa đón khách (đính kèm KH)' },
    { key: 'Khác', label: 'Khác (đính kèm KH)' }
  ],
  meetingRooms: [
    { id: 1, name: 'Phòng Họp Lớn A (Tầng 3 - Sức chứa 50 người)', short: 'Phòng A (50 người)' },
    { id: 2, name: 'Phòng Họp Nhỏ B (Tầng 2 - Sức chứa 15 người)', short: 'Phòng B (15 người)' },
    { id: 3, name: 'Phòng Hội Thảo Trực Tuyến C (Tầng 5)', short: 'Phòng C (Online)' }
  ],
  users: [bookerUser, roomManagerUser, adminUser, driverUser, driverUser2, noDispatchApproverUser, dispatchApproverUser],
  meetings: [], meetingMinutes: [], meetingAttendeeTemplates: [],
  carRegs: [], workflows: [],
  // 2 phòng ban RIÊNG cho kịch bản carDispatch bên dưới — chưa dùng bởi bất kỳ phiếu xe nào ở các test
  // C1-C13 phía trên (đều dùng dept 'Phòng Kinh Doanh', luôn fallback approvers {} -> chỉ admin qua
  // được canApproveStep), nên thêm 2 dept này KHÔNG ảnh hưởng gì tới các test hiện có.
  carDeptWorkflows: {
    'Phòng Hành Chính': { workflowId: 'WF_1STEP', approvers: { 1: ['qlxe_nd'] } },
    'Ban Giám Đốc': { workflowId: 'WF_1STEP', approvers: { 1: ['qlxe_dp'] } }
  },
  tasks: [], permGroups: [], vppExcludeGroups: [],
  vppPeriods: [], vppRegistrations: [], vppDeptWorkflows: {},
  budgetEntries: [], budgetDeptWorkflows: {},
  itPriceApprovals: [], itPriceDeptWorkflows: {},
  _versions: {}
};
store.users = seedDB.users; // mirror routes/workflow.js's req.allUsers cho applyWorkflowAction xác thực assignedDriverUsername.
store.carDeptWorkflows = seedDB.carDeptWorkflows; // mirror appData thật cho route /api/workflow/carRegs ở trên.
store.workflows = seedDB.workflows;

async function loginAs(page, user) {
  activeServerUser = user;
  await page.evaluate((u) => {
    window.__alerts = [];
    finishLogin(u);
  }, user);
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));
  await page.goto(`http://localhost:${PORT}/`);

  // Ha tang: nap module theo cum, dot 7 (server/public/js/*.js) - test o day drive truc tiep ham
  // module-*.js qua page.evaluate()/click that thay vi luon di qua switchTab() nhu nguoi dung that,
  // nen chu dong nap TOAN BO cum module ngay tu dau (gia lap 1 phien da tung mo het moi tab) -
  // khong doi ket qua test nao (van goi dung ham that).
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate((seed) => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    Object.assign(DB, seed);
  }, seedDB);

  await loginAs(page, bookerUser);

  // ===================== MEETING ROOM: M1 — happy path via Outlook-style multi-slot calendar select =====
  const m1 = await page.evaluate(async ({ room }) => {
    window.__alerts = [];
    switchTab('meeting');
    setMeetingSubTab('CALENDAR');
    document.getElementById('meetingCalDate').value = '2026-09-01';
    renderMeetingCalendar();
    const roomIdx = DB.meetingRooms.findIndex((r) => r.name === room);
    // Mô phỏng kéo chuột/Shift+bấm chọn liên tiếp 07:00 -> 08:30 (3 ô 30 phút = slot 0..2) trong đúng 1 cột phòng.
    finalizeMeetingSlotSelection(roomIdx, 0, 2);
    const prefilledStart = document.getElementById('meetingStartTime').value;
    const prefilledEnd = document.getElementById('meetingEndTime').value;
    const prefilledRoom = document.getElementById('meetingRoom').value;

    document.getElementById('meetingDept').value = 'Phòng Kinh Doanh';
    document.getElementById('meetingTitle').value = 'Họp review dự án Q3';
    document.getElementById('meetingAttendees').value = '8';
    document.getElementById('meetingEquipment').value = 'Máy chiếu';
    document.getElementById('meetingAgenda').value = '1. Review tiến độ. 2. Rủi ro.';
    const codeBefore = document.getElementById('meetingCode').value;

    const form = document.querySelector('#meetingRegisterTabContent form');
    await submitMeetingReq({ preventDefault() {}, target: form });

    return {
      alerts: window.__alerts.slice(),
      prefilledStart, prefilledEnd, prefilledRoom,
      count: DB.meetings.length,
      saved: DB.meetings[0]
    };
  }, { room: ROOM });

  record(
    'Meeting: Outlook-style multi-slot calendar selection pre-fills 07:00–08:30 for the chosen room',
    m1.prefilledRoom === ROOM && m1.prefilledStart.endsWith('T07:00') && m1.prefilledEnd.endsWith('T08:30'),
    `room=${m1.prefilledRoom} start=${m1.prefilledStart} end=${m1.prefilledEnd}`
  );
  record(
    'Meeting: happy-path booking saved as PENDING',
    m1.count === 1 && m1.saved.status === 'PENDING' && m1.saved.creator === bookerUser.username,
    `count=${m1.count} status=${m1.saved && m1.saved.status} alerts=${JSON.stringify(m1.alerts)}`
  );

  // ===================== M2 — double-booking conflict rejected client-side at creation =====================
  const m2 = await page.evaluate(async ({ room }) => {
    window.__alerts = [];
    document.getElementById('meetingCode').value = generateMeetingCode();
    document.getElementById('meetingRoom').value = room;
    document.getElementById('meetingDept').value = 'Phòng Kinh Doanh';
    document.getElementById('meetingTitle').value = 'Họp trùng giờ (phải bị từ chối)';
    document.getElementById('meetingAttendees').value = '4';
    document.getElementById('meetingStartTime').value = '2026-09-01T07:30';
    document.getElementById('meetingEndTime').value = '2026-09-01T08:00';
    document.getElementById('meetingEquipment').value = '';
    document.getElementById('meetingAgenda').value = 'Nội dung bất kỳ';
    const countBefore = DB.meetings.length;
    const form = document.querySelector('#meetingRegisterTabContent form');
    await submitMeetingReq({ preventDefault() {}, target: form });
    return { alerts: window.__alerts.slice(), countBefore, countAfter: DB.meetings.length };
  }, { room: ROOM });

  record(
    'Meeting: overlapping booking in the same room is rejected as a double-booking conflict',
    m2.alerts.some((a) => a.includes('đã có lịch trùng khung giờ')) && m2.countAfter === m2.countBefore,
    `alerts=${JSON.stringify(m2.alerts)}`
  );

  // ===================== M3 — self-cancel: creator cancels their own PENDING booking =====================
  const m3 = await page.evaluate(async (meetingId) => {
    window.__alerts = [];
    runMeetingAction(meetingId, 'cancel');
    // runMeetingAction -> cancelMeeting() là async (chờ fetch) — chờ 1 vòng microtask/HTTP round-trip.
    await new Promise((r) => setTimeout(r, 200));
    return { alerts: window.__alerts.slice(), status: DB.meetings.find((m) => m.id === meetingId).status };
  }, m1.saved.id);

  record(
    'Meeting: creator can self-cancel their own booking without any special permission',
    m3.status === 'CANCELLED',
    `status=${m3.status} alerts=${JSON.stringify(m3.alerts)}`
  );

  // ===================== M4/M5/M6 — approve + room-manager cancel-all (different actor) =====================
  const m4 = await page.evaluate(async ({ room }) => {
    window.__alerts = [];
    document.getElementById('meetingCode').value = generateMeetingCode();
    document.getElementById('meetingRoom').value = room;
    document.getElementById('meetingDept').value = 'Phòng Kinh Doanh';
    document.getElementById('meetingTitle').value = 'Họp giao ban tháng';
    document.getElementById('meetingAttendees').value = '10';
    document.getElementById('meetingStartTime').value = '2026-09-02T09:00';
    document.getElementById('meetingEndTime').value = '2026-09-02T10:00';
    document.getElementById('meetingEquipment').value = '';
    document.getElementById('meetingAgenda').value = 'Giao ban tháng 9';
    const form = document.querySelector('#meetingRegisterTabContent form');
    await submitMeetingReq({ preventDefault() {}, target: form });
    return { savedId: DB.meetings.find((m) => m.title === 'Họp giao ban tháng').id };
  }, { room: ROOM });

  await loginAs(page, roomManagerUser);
  const m5 = await page.evaluate(async (meetingId) => {
    window.__alerts = [];
    switchTab('meeting');
    const canApproveBefore = canApproveMeeting(currentUser);
    const canCancelOthersBefore = canCancelMeeting(currentUser, { creator: 'someone-else' });
    runMeetingAction(meetingId, 'approve');
    await new Promise((r) => setTimeout(r, 200));
    const statusAfterApprove = DB.meetings.find((m) => m.id === meetingId).status;
    runMeetingAction(meetingId, 'cancel');
    await new Promise((r) => setTimeout(r, 200));
    const statusAfterCancel = DB.meetings.find((m) => m.id === meetingId).status;
    return { canApproveBefore, canCancelOthersBefore, statusAfterApprove, statusAfterCancel, alerts: window.__alerts.slice() };
  }, m4.savedId);

  record(
    'Meeting: room manager (meetingApprove) approves a booking created by someone else',
    m5.canApproveBefore === true && m5.statusAfterApprove === 'APPROVED',
    `statusAfterApprove=${m5.statusAfterApprove}`
  );
  record(
    'Meeting: room manager (meetingCancel) can cancel ANY booking, not just their own',
    m5.canCancelOthersBefore === true && m5.statusAfterCancel === 'CANCELLED',
    `statusAfterCancel=${m5.statusAfterCancel} alerts=${JSON.stringify(m5.alerts)}`
  );

  // ===================== M7 — defense in depth: server re-validates conflict at approve time =====================
  // Mô phỏng 2 lịch PENDING cùng phòng/trùng giờ đã lọt qua được (race condition thật, hoặc dữ liệu cũ) —
  // duyệt lịch thứ 2 phải bị server chặn lại bằng đúng kiểm tra trùng lịch, không chỉ tin cờ PENDING.
  const raceMeetingA = { id: 555001, code: 'HCRC-DPH-RACE-A', dept: 'Phòng Kinh Doanh', room: ROOM,
    title: 'Race A', attendees: 5, startTime: '2026-09-03T09:00', endTime: '2026-09-03T10:00',
    equipment: '', agenda: '', createdAt: '01/09/2026', status: 'PENDING', creator: bookerUser.username, creatorName: bookerUser.name };
  const raceMeetingB = { ...raceMeetingA, id: 555002, code: 'HCRC-DPH-RACE-B', title: 'Race B', startTime: '2026-09-03T09:30', endTime: '2026-09-03T10:30' };
  store.meetings.push(raceMeetingA, raceMeetingB);
  const m7 = await page.evaluate(({ a, b }) => { DB.meetings.push(a, b); }, { a: raceMeetingA, b: raceMeetingB });
  const m7result = await page.evaluate(async (meetingBId) => {
    window.__alerts = [];
    runMeetingAction(meetingBId, 'approve');
    await new Promise((r) => setTimeout(r, 200));
    return { alerts: window.__alerts.slice(), status: DB.meetings.find((m) => m.id === meetingBId).status };
  }, raceMeetingB.id);

  record(
    'Meeting: server re-checks room conflict at approve time even if 2 overlapping bookings both reached PENDING',
    m7result.alerts.some((a) => a.includes('đã có lịch trùng khung giờ')) && m7result.status === 'PENDING',
    `status=${m7result.status} alerts=${JSON.stringify(m7result.alerts)}`
  );

  // ===================== CAR REGISTRATION =====================
  await loginAs(page, bookerUser);
  const c1 = await page.evaluate(async () => {
    window.__alerts = [];
    switchTab('car');
    document.getElementById('carDept').value = 'Phòng Kinh Doanh';
    document.getElementById('carType').value = document.getElementById('carType').options[0].value;
    document.getElementById('carPassengers').value = '02 - Lê Thị Kinh Doanh, Khách hàng';
    document.getElementById('carPurpose').value = 'Công tác';
    document.getElementById('carKm').value = '120';
    document.getElementById('carStartTime').value = '2026-09-05T08:00';
    document.getElementById('carEndTime').value = '2026-09-05T12:00';
    carRoutePoints = ['HN', 'Hải Phòng', 'HN'];
    renderCarRoutePoints();
    document.getElementById('carReason').value = 'Gặp đối tác ký hợp đồng.';
    const form = document.querySelector('#carSection form');
    await submitCarReq({ preventDefault() {}, target: form });
    return { alerts: window.__alerts.slice(), count: DB.carRegs.length, saved: DB.carRegs[0] };
  });

  record(
    'Car: happy-path registration (multi-point route) saved as PENDING step 1',
    c1.count === 1 && c1.saved.status === 'PENDING' && c1.saved.currentStep === 1
      && c1.saved.destination === 'HN → Hải Phòng → HN'
      && Array.isArray(c1.saved.routePoints) && c1.saved.routePoints.length === 3,
    `count=${c1.count} status=${c1.saved && c1.saved.status} dest=${c1.saved && c1.saved.destination} alerts=${JSON.stringify(c1.alerts)}`
  );

  const c2 = await page.evaluate(async () => {
    window.__alerts = [];
    document.getElementById('carCode').value = generateCarCode();
    document.getElementById('carDept').value = 'Phòng Kinh Doanh';
    document.getElementById('carType').value = document.getElementById('carType').options[0].value;
    document.getElementById('carPassengers').value = '01';
    document.getElementById('carPurpose').value = 'Khác';
    document.getElementById('carKm').value = '80';
    document.getElementById('carStartTime').value = '2026-09-05T10:00'; // chồng lấn với phiếu C1 (08:00-12:00)
    document.getElementById('carEndTime').value = '2026-09-05T14:00';
    carRoutePoints = ['HN', 'Bắc Ninh', 'HN'];
    renderCarRoutePoints();
    document.getElementById('carReason').value = 'Giao hàng gấp.';
    const form = document.querySelector('#carSection form');
    await submitCarReq({ preventDefault() {}, target: form });
    return { count: DB.carRegs.length, saved: DB.carRegs[0] };
  });
  record('Car: second registration (different time slot request) is accepted — car creation has no room-style lock', c2.count === 2, `count=${c2.count}`);

  // Duyệt & gán biển số cho phiếu 1 (Admin) — workflow mặc định 1 bước, chỉ admin qua được canApproveStep.
  await loginAs(page, adminUser);
  const c3 = await page.evaluate(async (carId) => {
    window.__alerts = [];
    switchTab('car');
    currentProcessingCarId = carId;
    document.getElementById('carAssignedDriver').value = 'Nguyễn Văn Tài — Phòng Hành Chính (lx1)';
    resolveCarAssignedDriverInput(document.getElementById('carAssignedDriver').value);
    document.getElementById('carAssignedVehicleType').value = 'Toyota Innova 7 chỗ';
    document.getElementById('carAssignedPlate').value = '30F-123.45';
    document.getElementById('txtCarComment').value = '';
    await processCarReg('APPROVE');
    const item = DB.carRegs.find((c) => c.id === carId);
    return {
      alerts: window.__alerts.slice(), status: item.status, plate: item.assignedPlate,
      driverUsername: item.assignedDriverUsername, driverName: item.assignedDriver
    };
  }, c1.saved.id);

  record(
    'Car: admin approves and assigns plate + driver account — single-step workflow completes',
    c3.status === 'APPROVED' && c3.plate === '30F-123.45'
      && c3.driverUsername === 'lx1' && c3.driverName === 'Nguyễn Văn Tài',
    `status=${c3.status} plate=${c3.plate} driver=${c3.driverUsername}/${c3.driverName} alerts=${JSON.stringify(c3.alerts)}`
  );

  // Duyệt phiếu 2, cố gán TRÙNG biển số 30F-123.45 trong khung giờ chồng lấn với phiếu 1 -> phải bị chặn.
  const c4 = await page.evaluate(async (carId) => {
    window.__alerts = [];
    currentProcessingCarId = carId;
    document.getElementById('carAssignedDriver').value = 'Trần Văn Lái — Phòng Hành Chính (lx2)';
    resolveCarAssignedDriverInput(document.getElementById('carAssignedDriver').value);
    document.getElementById('carAssignedVehicleType').value = 'Toyota Innova 7 chỗ';
    document.getElementById('carAssignedPlate').value = '30F-123.45';
    document.getElementById('txtCarComment').value = '';
    await processCarReg('APPROVE');
    const item = DB.carRegs.find((c) => c.id === carId);
    return { alerts: window.__alerts.slice(), status: item.status, plate: item.assignedPlate };
  }, c2.saved.id);

  record(
    'Car: assigning an already-in-use plate to an overlapping time window is rejected (double-booking)',
    c4.alerts.some((a) => a.includes('Biển số') && a.includes('trùng khung giờ')) && c4.status === 'PENDING',
    `status=${c4.status} alerts=${JSON.stringify(c4.alerts)}`
  );

  // Từ chối phiếu 2 với lý do — state transition thứ 2 (REJECTED), sau khi đổi biển số để không còn xung đột.
  const c5 = await page.evaluate(async (carId) => {
    window.__alerts = [];
    currentProcessingCarId = carId;
    // Từ chối thì không gán xe/lái xe nữa — để trống các ô phân công (khớp thao tác thật của người duyệt
    // khi quyết định từ chối), tránh input còn giữ lại giá trị biển số đã thử gán ở bước trước đó.
    document.getElementById('carAssignedDriver').value = '';
    document.getElementById('carAssignedDriverUsername').value = '';
    document.getElementById('carAssignedVehicleType').value = '';
    document.getElementById('carAssignedPlate').value = '';
    document.getElementById('txtCarComment').value = 'Không đủ điều kiện xe cho khung giờ này.';
    await processCarReg('REJECT');
    const item = DB.carRegs.find((c) => c.id === carId);
    return { alerts: window.__alerts.slice(), status: item.status };
  }, c2.saved.id);

  record(
    'Car: rejection with a reason transitions the registration to REJECTED',
    c5.status === 'REJECTED',
    `status=${c5.status} alerts=${JSON.stringify(c5.alerts)}`
  );

  // ===================== CAR REGISTRATION — new behaviors: multi-point route validation, mandatory
  // driver account, driver self-confirm, cross-department visibility for the assigned driver =====
  await loginAs(page, bookerUser);
  const carCountBeforeC6 = await page.evaluate(() => DB.carRegs.length);
  const c6 = await page.evaluate(async () => {
    window.__alerts = [];
    switchTab('car');
    document.getElementById('carDept').value = 'Phòng Kinh Doanh';
    document.getElementById('carType').value = document.getElementById('carType').options[0].value;
    document.getElementById('carPassengers').value = '01';
    document.getElementById('carPurpose').value = 'Công tác';
    document.getElementById('carKm').value = '50';
    document.getElementById('carStartTime').value = '2026-09-06T08:00';
    document.getElementById('carEndTime').value = '2026-09-06T12:00';
    carRoutePoints = ['HN']; // chỉ có Điểm xuất phát, thiếu điểm đến
    renderCarRoutePoints();
    document.getElementById('carReason').value = 'Thiếu điểm đến.';
    const form = document.querySelector('#carSection form');
    await submitCarReq({ preventDefault() {}, target: form });
    return { alerts: window.__alerts.slice(), count: DB.carRegs.length };
  });
  record(
    'Car: registering with fewer than 2 route points is blocked client-side (no record created)',
    c6.count === carCountBeforeC6 && c6.alerts.some((a) => a.includes('Vui lòng nhập ít nhất Điểm xuất phát')),
    `count=${c6.count} (was ${carCountBeforeC6}) alerts=${JSON.stringify(c6.alerts)}`
  );

  const c7 = await page.evaluate(async () => {
    window.__alerts = [];
    document.getElementById('carCode').value = generateCarCode();
    document.getElementById('carDept').value = 'Phòng Kinh Doanh';
    document.getElementById('carType').value = document.getElementById('carType').options[0].value;
    document.getElementById('carPassengers').value = '01';
    document.getElementById('carPurpose').value = 'Công tác';
    document.getElementById('carKm').value = '60';
    document.getElementById('carStartTime').value = '2026-09-06T08:00';
    document.getElementById('carEndTime').value = '2026-09-06T12:00';
    carRoutePoints = ['HN', 'Hạ Long', 'HN'];
    renderCarRoutePoints();
    document.getElementById('carReason').value = 'Khảo sát công trình.';
    const form = document.querySelector('#carSection form');
    await submitCarReq({ preventDefault() {}, target: form });
    return { count: DB.carRegs.length, saved: DB.carRegs[0] };
  });
  record(
    'Car: valid multi-point registration saved as PENDING (route bed for driver-account scenarios below)',
    c7.saved.status === 'PENDING' && c7.saved.destination === 'HN → Hạ Long → HN',
    `status=${c7.saved && c7.saved.status} dest=${c7.saved && c7.saved.destination}`
  );

  // Admin gõ tên lái xe tự do, KHÔNG chọn từ gợi ý (không gọi resolveCarAssignedDriverInput) -> phải bị
  // chặn ngay ở client, không gửi lên server, hồ sơ vẫn PENDING.
  await loginAs(page, adminUser);
  const c8 = await page.evaluate(async (carId) => {
    window.__alerts = [];
    switchTab('car');
    currentProcessingCarId = carId;
    document.getElementById('carAssignedDriver').value = 'Tên Tự Gõ Không Khớp Ai';
    document.getElementById('carAssignedVehicleType').value = 'Toyota Innova 7 chỗ';
    document.getElementById('carAssignedPlate').value = '29A-999.99';
    document.getElementById('txtCarComment').value = '';
    await processCarReg('APPROVE');
    const item = DB.carRegs.find((c) => c.id === carId);
    return { alerts: window.__alerts.slice(), status: item.status };
  }, c7.saved.id);
  record(
    'Car: approving with a driver name that does not resolve to a real account is blocked (mandatory account rule)',
    c8.status === 'PENDING' && c8.alerts.some((a) => a.includes('Vui lòng chọn đúng lái xe')),
    `status=${c8.status} alerts=${JSON.stringify(c8.alerts)}`
  );

  // Gõ lại đúng định dạng gợi ý (kích hoạt resolveCarAssignedDriverInput) rồi duyệt lại -> thành công.
  const c9 = await page.evaluate(async (carId) => {
    window.__alerts = [];
    currentProcessingCarId = carId;
    document.getElementById('carAssignedDriver').value = 'Nguyễn Văn Tài — Phòng Hành Chính (lx1)';
    resolveCarAssignedDriverInput(document.getElementById('carAssignedDriver').value);
    document.getElementById('carAssignedVehicleType').value = 'Toyota Innova 7 chỗ';
    document.getElementById('carAssignedPlate').value = '29A-999.99';
    document.getElementById('txtCarComment').value = '';
    await processCarReg('APPROVE');
    const item = DB.carRegs.find((c) => c.id === carId);
    return {
      alerts: window.__alerts.slice(), status: item.status,
      driverUsername: item.assignedDriverUsername, driverConfirmed: item.driverConfirmed
    };
  }, c7.saved.id);
  record(
    'Car: approving with a resolved driver account succeeds and starts unconfirmed',
    c9.status === 'APPROVED' && c9.driverUsername === 'lx1' && !c9.driverConfirmed,
    `status=${c9.status} driver=${c9.driverUsername} confirmed=${c9.driverConfirmed} alerts=${JSON.stringify(c9.alerts)}`
  );

  // Người KHÔNG phải lái xe được phân công (lx2) không tự xác nhận được chuyến của lx1 -> 403.
  let c10Error = null;
  try {
    const carRegOnServer = store.carRegs.find((c) => c.id === c7.saved.id);
    recordActions.confirmCarDriverAssignment(driverUser2, carRegOnServer);
  } catch (err) {
    c10Error = err;
  }
  record(
    'Car: a driver who is not the assigned one cannot confirm the trip (403)',
    !!c10Error && c10Error.status === 403,
    `error=${c10Error && c10Error.message}`
  );

  // Lái xe được phân công (lx1) tự vào sub-tab "Lái Xe" xác nhận đúng chuyến của mình.
  await loginAs(page, driverUser);
  const c11 = await page.evaluate(async (carId) => {
    window.__alerts = [];
    switchTab('car');
    setCarSubTab('DRIVER');
    const listedBeforeConfirm = document.getElementById('carDriverListWrap').innerHTML.includes(String(carId)) ||
      DB.carRegs.some((c) => c.id === carId && c.assignedDriverUsername === currentUser.username && c.status === 'APPROVED');
    confirmCarDriverAssignmentAction(carId);
    runConfirmedAction();
    await new Promise((r) => setTimeout(r, 200));
    const item = DB.carRegs.find((c) => c.id === carId);
    return { alerts: window.__alerts.slice(), listedBeforeConfirm, confirmed: item.driverConfirmed, confirmedAt: item.driverConfirmedAt };
  }, c7.saved.id);
  record(
    'Car: assigned driver self-confirms their trip from the "Lái Xe" sub-tab',
    c11.listedBeforeConfirm && c11.confirmed === true && !!c11.confirmedAt,
    `listedBeforeConfirm=${c11.listedBeforeConfirm} confirmed=${c11.confirmed} confirmedAt=${c11.confirmedAt} alerts=${JSON.stringify(c11.alerts)}`
  );

  // Lái xe được phân công luôn xem được phiếu của mình dù khác phòng ban và không có quyền carView; lái
  // xe KHÁC (chưa được phân công) thì không (canViewCarReg() — xem lib/recordViewScope.js).
  const c7ServerRecord = store.carRegs.find((c) => c.id === c7.saved.id);
  const c12CanDriver1View = canViewCarReg(driverUser, c7ServerRecord, { carDeptWorkflows: {}, workflows: [] });
  const c12CanDriver2View = canViewCarReg(driverUser2, c7ServerRecord, { carDeptWorkflows: {}, workflows: [] });
  record(
    'Car: assigned driver can view the trip across departments; an unassigned driver cannot',
    c12CanDriver1View === true && c12CanDriver2View === false,
    `driver1(assigned)=${c12CanDriver1View} driver2(unassigned)=${c12CanDriver2View}`
  );

  // Đổi sang lái xe khác trên 1 hồ sơ đã từng được xác nhận trước đó -> phải hủy xác nhận cũ, vì trách
  // nhiệm chuyến đi đã chuyển người (xem applyWorkflowAction() ở lib/workflowEngine.js).
  const c13Item = {
    id: 900001, code: 'HCRC-DPH-REASSIGN', dept: 'Phòng Kinh Doanh', status: 'PENDING', currentStep: 1,
    history: [], startTime: '2026-09-07T08:00', endTime: '2026-09-07T12:00',
    assignedDriverUsername: 'lx1', assignedDriver: 'Nguyễn Văn Tài',
    driverConfirmed: true, driverConfirmedAt: '01/09/2026 07:00'
  };
  const c13Outcome = applyWorkflowAction({
    moduleKey: 'carRegs', item: c13Item, action: 'APPROVE', user: adminUser, comment: '',
    extraFields: { assignedDriverUsername: 'lx2', assignedPlate: '29A-111.11' },
    appData: { carDeptWorkflows: {}, workflows: [] }, existingCollection: [], users: seedDB.users
  });
  record(
    'Car: reassigning to a different driver resets a prior driver confirmation',
    c13Outcome.item.assignedDriverUsername === 'lx2' && c13Outcome.item.driverConfirmed === false && c13Outcome.item.driverConfirmedAt === null,
    `driver=${c13Outcome.item.assignedDriverUsername} confirmed=${c13Outcome.item.driverConfirmed} confirmedAt=${c13Outcome.item.driverConfirmedAt}`
  );

  // ===================== CAR REGISTRATION — carDispatch ("Người Điều Hành Xe", Phase 3): gates ONLY
  // the "Phần Dành Cho Phòng Hành Chính" assignment section (driver/vehicle type/plate), separately from
  // the step-approver check (canApproveStep) which stays untouched — an approver without carDispatch
  // must still be able to Duyệt/Từ chối their step normally. =====================
  const itemNoDispatch = {
    id: 900301, code: 'HCRC-DPH-ND', dept: 'Phòng Hành Chính', status: 'PENDING', currentStep: 1,
    history: [], type: 'Xe 4 chỗ', km: '40', passengers: '01', purpose: 'Công tác',
    startTime: '2026-09-08T08:00', endTime: '2026-09-08T12:00', destination: 'HN', reason: 'Kiểm tra carDispatch',
    creator: bookerUser.username, creatorName: bookerUser.name,
    // Giá trị ĐÃ gán TRƯỚC lúc duyệt — approver không có carDispatch cố sửa lại thì giá trị này PHẢI
    // được giữ nguyên (server lờ đi field client gửi, không ghi đè).
    assignedVehicleType: 'Xe cũ đã gán trước khi duyệt'
  };
  const itemWithDispatch = {
    id: 900302, code: 'HCRC-DPH-WD', dept: 'Ban Giám Đốc', status: 'PENDING', currentStep: 1,
    history: [], type: 'Xe 7 chỗ', km: '60', passengers: '02', purpose: 'Công tác',
    startTime: '2026-09-08T08:00', endTime: '2026-09-08T12:00', destination: 'HN', reason: 'Kiểm tra carDispatch',
    creator: bookerUser.username, creatorName: bookerUser.name
  };
  store.carRegs.push(itemNoDispatch, itemWithDispatch);
  await page.evaluate(({ a, b }) => { DB.carRegs.push(a, b); }, { a: itemNoDispatch, b: itemWithDispatch });

  // D1 — approver KHÔNG có carDispatch: modal ẩn mục phân công. Cố tình dùng thẳng callWorkflowAction()
  // (giả lập DevTools sửa request tay, bỏ qua guard phía client) để gửi kèm field phân công -> server
  // phải tự lờ đi hoàn toàn, KHÔNG lỗi cả lượt duyệt, KHÔNG ghi đè giá trị cũ.
  await loginAs(page, noDispatchApproverUser);
  const d1 = await page.evaluate(async (carId) => {
    window.__alerts = [];
    switchTab('car');
    openCarProcessModal(carId);
    const sectionHiddenAtOpen = document.getElementById('carDispatchSection').classList.contains('hidden');
    const hasActionButtons = document.getElementById('carModalActionBtns').innerHTML.includes('Phê Duyệt');
    const result = await callWorkflowAction('carRegs', carId, 'approve', {
      comment: '',
      extraFields: { assignedDriverUsername: 'lx1', assignedVehicleType: 'Xe MỚI (không được phép gán)', assignedPlate: '51A-999.99' }
    });
    return {
      sectionHiddenAtOpen, hasActionButtons,
      status: result.item.status,
      assignedVehicleType: result.item.assignedVehicleType,
      assignedPlate: result.item.assignedPlate,
      assignedDriverUsername: result.item.assignedDriverUsername
    };
  }, itemNoDispatch.id);
  record(
    'CarDispatch: approver WITHOUT carDispatch — "Phần Dành Cho Phòng Hành Chính" is hidden in the modal',
    d1.sectionHiddenAtOpen === true,
    `sectionHiddenAtOpen=${d1.sectionHiddenAtOpen}`
  );
  record(
    'CarDispatch: approver WITHOUT carDispatch can still approve their step normally',
    d1.hasActionButtons === true && d1.status === 'APPROVED',
    `hasActionButtons=${d1.hasActionButtons} status=${d1.status}`
  );
  record(
    'CarDispatch: server silently ignores tampered assignment fields from a non-carDispatch approver (old value kept, no driver/plate written)',
    d1.assignedVehicleType === 'Xe cũ đã gán trước khi duyệt' && !d1.assignedPlate && !d1.assignedDriverUsername,
    `assignedVehicleType=${d1.assignedVehicleType} assignedPlate=${d1.assignedPlate} assignedDriverUsername=${d1.assignedDriverUsername}`
  );

  // D2 — approver CÓ carDispatch: modal hiện mục phân công; Duyệt + gán lái xe/loại xe/BKS trong CÙNG 1
  // lượt thao tác qua đúng luồng UI thật (processCarReg), không tắt qua callWorkflowAction thẳng.
  await loginAs(page, dispatchApproverUser);
  const d2 = await page.evaluate(async (carId) => {
    window.__alerts = [];
    switchTab('car');
    openCarProcessModal(carId);
    const sectionHiddenAtOpen = document.getElementById('carDispatchSection').classList.contains('hidden');
    document.getElementById('carAssignedDriver').value = 'Nguyễn Văn Tài — Phòng Hành Chính (lx1)';
    resolveCarAssignedDriverInput(document.getElementById('carAssignedDriver').value);
    document.getElementById('carAssignedVehicleType').value = 'Ford Transit 16 chỗ';
    document.getElementById('carAssignedPlate').value = '51A-777.77';
    document.getElementById('txtCarComment').value = '';
    await processCarReg('APPROVE');
    const item = DB.carRegs.find((c) => c.id === carId);
    return {
      sectionHiddenAtOpen, alerts: window.__alerts.slice(), status: item.status,
      assignedVehicleType: item.assignedVehicleType, assignedPlate: item.assignedPlate, assignedDriverUsername: item.assignedDriverUsername
    };
  }, itemWithDispatch.id);
  record(
    'CarDispatch: approver WITH carDispatch — "Phần Dành Cho Phòng Hành Chính" is visible in the modal',
    d2.sectionHiddenAtOpen === false,
    `sectionHiddenAtOpen=${d2.sectionHiddenAtOpen}`
  );
  record(
    'CarDispatch: approver WITH carDispatch can approve AND set driver/vehicle/plate in the same action',
    d2.status === 'APPROVED' && d2.assignedPlate === '51A-777.77' && d2.assignedVehicleType === 'Ford Transit 16 chỗ' && d2.assignedDriverUsername === 'lx1',
    `status=${d2.status} plate=${d2.assignedPlate} type=${d2.assignedVehicleType} driver=${d2.assignedDriverUsername} alerts=${JSON.stringify(d2.alerts)}`
  );

  // D3 — Từ chối cũng phải bị lờ đi field phân công nếu người từ chối không có carDispatch.
  // LƯU Ý: itemNoDispatch đã bị applyWorkflowAction() ở D1 MUTATE tại chỗ (status -> 'APPROVED',
  // history đã có dòng) — không spread trực tiếp từ nó nữa, phải nêu rõ lại status/currentStep/history
  // PENDING/1/[] cho bản ghi MỚI này, tránh dính luôn trạng thái đã bị đổi của D1.
  const itemNoDispatchReject = {
    ...itemNoDispatch, id: 900303, code: 'HCRC-DPH-ND-REJ',
    status: 'PENDING', currentStep: 1, history: [], assignedVehicleType: undefined
  };
  store.carRegs.push(itemNoDispatchReject);
  await page.evaluate((item) => { DB.carRegs.push(item); }, itemNoDispatchReject);
  await loginAs(page, noDispatchApproverUser);
  const d3 = await page.evaluate(async (carId) => {
    window.__alerts = [];
    const result = await callWorkflowAction('carRegs', carId, 'reject', {
      comment: 'Không đủ điều kiện.',
      extraFields: { assignedDriverUsername: 'lx1', assignedVehicleType: 'Không được phép', assignedPlate: '51A-000.00' }
    });
    return { status: result.item.status, assignedVehicleType: result.item.assignedVehicleType, assignedPlate: result.item.assignedPlate };
  }, itemNoDispatchReject.id);
  record(
    'CarDispatch: non-carDispatch approver can reject their step, and tampered assignment fields are still ignored on reject',
    d3.status === 'REJECTED' && !d3.assignedVehicleType && !d3.assignedPlate,
    `status=${d3.status} type=${d3.assignedVehicleType} plate=${d3.assignedPlate}`
  );

  // ===================== D4/D5 — sidebar-access gap fix: a pure-driver account (no carView, not an
  // approver in ANY carDeptWorkflows) must now reach the "🚗 Đăng ký xe" sidebar tab if they are the
  // assigned driver on at least 1 record. NOTE: scopeHasAny() (pre-existing helper, unrelated to this
  // phase — see git blame commit c36cf63, long before carDispatch existed) already returns true for ANY
  // user that merely has a `dept` set, regardless of the scope's actual content — so canAccessCarModule()
  // (like canAccessSubmissionModule/canAccessContractModule/canAccessOfficeModule, which share the same
  // helper) was ALREADY open to every dept-having employee at the sidebar level before this phase, and
  // isAssignedDriverSomewhere() does not change that baseline. What this phase's new OR-clause must NOT
  // do is fabricate a false "assigned driver" match for someone with zero assigned trips — verified
  // directly below instead of through the (pre-existing-broad) canAccessCarModule() gate. =====================
  await loginAs(page, driverUser); // lx1 — assigned driver on c7 (đã xác nhận ở kịch bản C11 phía trên).
  const d4 = await page.evaluate(() => {
    window.__alerts = [];
    const canAccessBefore = canAccessCarModule(currentUser);
    switchTab('car'); // trước fix: bị chặn ngay với alert "⛔ ... Module Đăng ký xe!"
    return { canAccessBefore, alertsAfterSwitch: window.__alerts.slice() };
  });
  record(
    'CarDispatch gap fix: an assigned-driver-only account (no carView/approver rights) can now access the car module sidebar tab',
    d4.canAccessBefore === true && !d4.alertsAfterSwitch.some((a) => a.includes('Module Đăng ký xe')),
    `canAccessBefore=${d4.canAccessBefore} alerts=${JSON.stringify(d4.alertsAfterSwitch)}`
  );

  await loginAs(page, driverUser2); // lx2 — chưa từng được phân công phiếu xe nào.
  const d5 = await page.evaluate(() => {
    const isAssignedDriverSomewhere = (DB.carRegs || []).some((c) => c.assignedDriverUsername === currentUser.username);
    return { isAssignedDriverSomewhere };
  });
  record(
    'CarDispatch gap fix: the new isAssignedDriverSomewhere clause does not fabricate a match for an account with no assigned trips (fix is not overly broad)',
    d5.isAssignedDriverSomewhere === false,
    `isAssignedDriverSomewhere=${d5.isAssignedDriverSomewhere}`
  );

  // ===================== E1-E4 — "Bổ Sung" (REQUEST_CHANGES): approver trả phiếu về NHÁP, người đăng
  // ký SỬA LẠI TOÀN BỘ nội dung (kể cả lộ trình/thời gian) qua modal "Sửa & Gửi Lại"
  // (openBosungEditModal()/confirmBosungResubmit() ở public/index.html, gọi THẬT
  // lib/recordActions.js editCarRegDraft()/submitCarRegDraft()) rồi được duyệt lại bình thường từ bước 1.
  // =====================
  await loginAs(page, bookerUser);
  const e1 = await page.evaluate(async () => {
    window.__alerts = [];
    switchTab('car');
    document.getElementById('carDept').value = 'Phòng Kinh Doanh';
    document.getElementById('carType').value = document.getElementById('carType').options[0].value;
    document.getElementById('carPassengers').value = '01 - Lê Thị Kinh Doanh';
    document.getElementById('carPurpose').value = 'Công tác';
    document.getElementById('carKm').value = '50';
    document.getElementById('carStartTime').value = '2026-09-10T08:00';
    document.getElementById('carEndTime').value = '2026-09-10T12:00';
    carRoutePoints = ['HN', 'Bắc Ninh', 'HN'];
    renderCarRoutePoints();
    document.getElementById('carReason').value = 'Khảo sát địa điểm cho kịch bản Bổ Sung.';
    const form = document.querySelector('#carSection form');
    await submitCarReq({ preventDefault() {}, target: form });
    return { count: DB.carRegs.length, saved: DB.carRegs[0] };
  });
  record(
    'Car Bổ Sung: tạo phiếu mới để kiểm thử luồng Bổ Sung -> PENDING',
    e1.saved.status === 'PENDING' && e1.saved.dept === 'Phòng Kinh Doanh',
    `status=${e1.saved.status} dept=${e1.saved.dept}`
  );

  // approvers['Phòng Kinh Doanh'] chưa được seed -> chỉ admin duyệt được (fallback {1:['admin']}).
  await loginAs(page, adminUser);
  const e2 = await page.evaluate(async (carId) => {
    window.__alerts = [];
    currentProcessingCarId = carId;
    document.getElementById('txtCarComment').value = '';
    await processCarReg('REQUEST_CHANGES'); // thiếu lý do -> bị chặn ở client, không gọi API
    const blockedAlerts = window.__alerts.slice();
    document.getElementById('txtCarComment').value = 'Sai lộ trình, đề nghị đăng ký lại đúng điểm đến.';
    window.__alerts = [];
    await processCarReg('REQUEST_CHANGES');
    await new Promise((r) => setTimeout(r, 50));
    const item = DB.carRegs.find((c) => c.id === carId);
    return { blockedAlerts, alerts: window.__alerts.slice(), status: item.status, currentStep: item.currentStep, history: item.history };
  }, e1.saved.id);
  record(
    'Car Bổ Sung: thiếu lý do bị chặn ngay ở client',
    e2.blockedAlerts.some((a) => a.includes('Vui lòng nhập lý do cần bổ sung')),
    JSON.stringify(e2.blockedAlerts)
  );
  record(
    'Car Bổ Sung: "Bổ Sung" hợp lệ -> status chuyển DRAFT, currentStep reset về 0',
    e2.status === 'DRAFT' && e2.currentStep === 0,
    `status=${e2.status} currentStep=${e2.currentStep}`
  );
  record(
    'Car Bổ Sung: lịch sử ghi nhận đúng hành động REQUEST_CHANGES kèm lý do',
    (e2.history || []).some((h) => h.action === 'REQUEST_CHANGES' && h.comment.includes('Sai lộ trình')),
    JSON.stringify(e2.history)
  );

  // Người KHÔNG phải người tạo (adminUser) không sửa được hồ sơ NHÁP của người khác qua editCarRegDraft().
  let e3Error = null;
  try {
    const carOnServer = store.carRegs.find((c) => c.id === e1.saved.id);
    recordActions.editCarRegDraft({ reason: 'Hack' }, adminUser, carOnServer);
  } catch (err) { e3Error = err; }
  record(
    'Car Bổ Sung: người khác (không phải người tạo) không sửa được phiếu đang NHÁP này (403)',
    !!e3Error && e3Error.status === 403,
    `error=${e3Error && e3Error.message}`
  );

  await loginAs(page, bookerUser);
  const e4 = await page.evaluate(async (carId) => {
    window.__alerts = [];
    openBosungEditModal('carRegs', carId);
    const reasonNote = document.getElementById('bosungEditReasonNote').innerText;
    document.getElementById('bsReason').value = 'Khảo sát địa điểm (đã sửa đúng lộ trình theo yêu cầu).';
    await confirmBosungResubmit();
    await new Promise((r) => setTimeout(r, 100));
    const item = DB.carRegs.find((c) => c.id === carId);
    return { reasonNote, alerts: window.__alerts.slice(), status: item.status, currentStep: item.currentStep, reason: item.reason };
  }, e1.saved.id);
  record(
    'Car Bổ Sung: modal "Sửa & Gửi Lại" hiện đúng lý do người duyệt vừa yêu cầu',
    e4.reasonNote.includes('Sai lộ trình'),
    e4.reasonNote
  );
  record(
    'Car Bổ Sung: "Sửa & Gửi Lại" -> quay lại PENDING bước 1, nội dung đã cập nhật',
    e4.status === 'PENDING' && e4.currentStep === 1 && e4.reason.includes('đã sửa đúng lộ trình'),
    JSON.stringify(e4)
  );

  await loginAs(page, adminUser);
  const e5 = await page.evaluate(async (carId) => {
    currentProcessingCarId = carId;
    document.getElementById('txtCarComment').value = '';
    await processCarReg('APPROVE');
    return DB.carRegs.find((c) => c.id === carId).status;
  }, e1.saved.id);
  record(
    'Car Bổ Sung: sau khi bổ sung + gửi lại, phiếu được duyệt lại bình thường -> APPROVED',
    e5 === 'APPROVED',
    e5
  );

  // ===================== F1-F11 — Fix 4 (đợt rà soát nghiệp vụ, người dùng xác nhận "Thêm nút Hủy/Đổi
  // sau duyệt"): "Hủy chuyến" (cancelCarReg) reachable khi status===APPROVED — mirror canCancelMeeting()
  // (tự huỷ được của CHÍNH MÌNH HOẶC carDispatch/admin huỷ được của bất kỳ ai); "Đổi tài xế-xe"
  // (reassignCarDispatch) CHỈ carDispatch/admin, cũng CHỈ khi APPROVED, tái dùng findCarPlateConflict()
  // để chặn gán trùng biển số. Trước đây 1 phiếu đã APPROVED là ngõ cụt — chỉ admin xóa cứng được.
  // =====================
  const carF1 = {
    id: 900401, code: 'HCRC-DPH-F1', dept: 'Ban Giám Đốc', status: 'APPROVED', currentStep: 1, history: [],
    type: 'Xe 4 chỗ', km: '30', passengers: '01', purpose: 'Công tác',
    startTime: '2026-09-20T08:00', endTime: '2026-09-20T12:00', destination: 'HCM', reason: 'Fix 4 test cancel',
    creator: bookerUser.username, creatorName: bookerUser.name,
    assignedDriverUsername: 'lx1', assignedDriver: 'Nguyễn Văn Tài', assignedPlate: '51A-111.11', assignedVehicleType: 'Xe 4 chỗ',
    driverConfirmed: true, driverConfirmedAt: '18/09/2026 07:00'
  };
  const carF2 = {
    id: 900402, code: 'HCRC-DPH-F2', dept: 'Ban Giám Đốc', status: 'APPROVED', currentStep: 1, history: [],
    type: 'Xe 7 chỗ', km: '40', passengers: '02', purpose: 'Công tác',
    startTime: '2026-09-21T08:00', endTime: '2026-09-21T12:00', destination: 'HCM', reason: 'Fix 4 test reassign',
    creator: bookerUser.username, creatorName: bookerUser.name,
    assignedDriverUsername: 'lx1', assignedDriver: 'Nguyễn Văn Tài', assignedPlate: '51A-222.22', assignedVehicleType: 'Xe 7 chỗ',
    driverConfirmed: true, driverConfirmedAt: '18/09/2026 07:00'
  };
  // Chuyến KHÁC, TRÙNG khung giờ với carF2 nhưng biển số khác — dùng để test findCarPlateConflict()
  // chặn gán trùng biển số lúc "Đổi tài xế-xe" (mirror đúng conflict check applyWorkflowAction() đã có).
  const carF3Conflict = {
    id: 900403, code: 'HCRC-DPH-F3', dept: 'Ban Giám Đốc', status: 'APPROVED', currentStep: 1, history: [],
    startTime: '2026-09-21T09:00', endTime: '2026-09-21T11:00', destination: 'HN', reason: 'Fix 4 test conflict',
    creator: bookerUser.username, creatorName: bookerUser.name, assignedPlate: '51A-333.33'
  };
  const carF4 = {
    id: 900404, code: 'HCRC-DPH-F4', dept: 'Ban Giám Đốc', status: 'APPROVED', currentStep: 1, history: [],
    startTime: '2026-09-22T08:00', endTime: '2026-09-22T12:00', destination: 'HCM', reason: 'Fix 4 dispatcher-cancel test',
    creator: bookerUser.username, creatorName: bookerUser.name
  };
  const carF5Pending = {
    id: 900405, code: 'HCRC-DPH-F5', dept: 'Ban Giám Đốc', status: 'PENDING', currentStep: 1, history: [],
    startTime: '2026-09-23T08:00', endTime: '2026-09-23T12:00', destination: 'HCM', reason: 'Fix 4 pending guard',
    creator: bookerUser.username, creatorName: bookerUser.name
  };
  const carF9 = {
    id: 900409, code: 'HCRC-DPH-F9', dept: 'Ban Giám Đốc', status: 'APPROVED', currentStep: 1, history: [],
    type: 'Xe 4 chỗ', km: '20', passengers: '01', purpose: 'Công tác',
    startTime: '2026-09-24T08:00', endTime: '2026-09-24T12:00', destination: 'HCM', reason: 'Fix 4 UI gating test',
    creator: bookerUser.username, creatorName: bookerUser.name, assignedPlate: '', assignedDriverUsername: ''
  };
  store.carRegs.push(carF1, carF2, carF3Conflict, carF4, carF5Pending, carF9);
  await page.evaluate((items) => { items.forEach((c) => DB.carRegs.push(c)); }, [carF1, carF2, carF3Conflict, carF4, carF5Pending, carF9]);

  // F1 — người KHÔNG phải người tạo VÀ KHÔNG có carDispatch KHÔNG huỷ được chuyến của người khác.
  await loginAs(page, noDispatchApproverUser);
  const f1 = await page.evaluate(async (carId) => {
    try { await callRecordAction('carRegs', carId, 'cancel', { reason: 'thử trái phép' }); return { ok: true }; }
    catch (err) { return { ok: false, message: err.message }; }
  }, carF1.id);
  record('Fix 4: người KHÔNG phải chủ chuyến và KHÔNG có carDispatch KHÔNG hủy được chuyến của người khác (403)', !f1.ok, JSON.stringify(f1));

  // F2 — chính người tạo (self-cancel, không cần quyền gì thêm) hủy được chuyến của MÌNH.
  await loginAs(page, bookerUser);
  const f2 = await page.evaluate(async (carId) => {
    const result = await callRecordAction('carRegs', carId, 'cancel', { reason: 'Đổi kế hoạch công tác' });
    const idx = DB.carRegs.findIndex((c) => c.id === carId);
    DB.carRegs[idx] = result.item;
    return result.item;
  }, carF1.id);
  record('Fix 4: chính người tạo (self-cancel) HỦY được chuyến APPROVED của mình -> CANCELLED', f2.status === 'CANCELLED', JSON.stringify(f2));
  record(
    'Fix 4: hủy chuyến ghi đúng cancelledBy/cancelledByName + dòng lịch sử CANCELLED kèm lý do',
    f2.cancelledBy === bookerUser.username && f2.cancelledByName === bookerUser.name &&
      (f2.history || []).some((h) => h.action === 'CANCELLED' && h.comment.includes('Đổi kế hoạch')),
    JSON.stringify(f2)
  );

  // F3 — hủy lại 1 chuyến ĐÃ hủy trước đó -> 409 (không hủy lại được).
  const f3 = await page.evaluate(async (carId) => {
    try { await callRecordAction('carRegs', carId, 'cancel', { reason: 'again' }); return { ok: true }; }
    catch (err) { return { ok: false, message: err.message }; }
  }, carF1.id);
  record('Fix 4: hủy lại 1 chuyến ĐÃ CANCELLED trước đó bị chặn (409)', !f3.ok, JSON.stringify(f3));

  // F4 — carDispatch hủy được chuyến của NGƯỜI KHÁC (không phải chủ hồ sơ), khác self-cancel ở F2.
  await loginAs(page, dispatchApproverUser);
  const f4 = await page.evaluate(async (carId) => {
    const result = await callRecordAction('carRegs', carId, 'cancel', { reason: 'Điều phối lại chuyến' });
    return result.item;
  }, carF4.id);
  record('Fix 4: carDispatch (Người Điều Hành Xe) HỦY được BẤT KỲ chuyến nào, không chỉ của chính mình', f4.status === 'CANCELLED', JSON.stringify(f4));

  // F5 — chuyến còn PENDING (chưa duyệt xong) không hủy được qua kênh "Hủy chuyến" này (dùng Từ chối ở
  // bước duyệt, hoặc admin xóa cứng, như trước đây).
  await loginAs(page, bookerUser);
  const f5 = await page.evaluate(async (carId) => {
    try { await callRecordAction('carRegs', carId, 'cancel', { reason: 'x' }); return { ok: true }; }
    catch (err) { return { ok: false, message: err.message }; }
  }, carF5Pending.id);
  record('Fix 4: "Hủy chuyến" bị chặn trên 1 phiếu còn PENDING (chưa APPROVED) (409)', !f5.ok, JSON.stringify(f5));

  // F6 — người tạo (KHÔNG có carDispatch) KHÔNG đổi được tài xế-xe, kể cả trên chuyến của chính mình.
  const f6 = await page.evaluate(async (carId) => {
    try { await callRecordAction('carRegs', carId, 'reassign', { assignedDriverUsername: 'lx2', assignedPlate: '51A-999.99' }); return { ok: true }; }
    catch (err) { return { ok: false, message: err.message }; }
  }, carF2.id);
  record('Fix 4: người tạo (KHÔNG có carDispatch) KHÔNG đổi được tài xế-xe, kể cả trên chuyến của chính mình (403)', !f6.ok, JSON.stringify(f6));

  // F7a — đổi biển số TRÙNG với 1 chuyến APPROVED khác cùng trùng khung giờ -> chặn (mirror
  // findCarPlateConflict() ở applyWorkflowAction()).
  await loginAs(page, dispatchApproverUser);
  const f7a = await page.evaluate(async (carId) => {
    try { await callRecordAction('carRegs', carId, 'reassign', { assignedPlate: '51A-333.33' }); return { ok: true }; }
    catch (err) { return { ok: false, message: err.message }; }
  }, carF2.id);
  record('Fix 4: "Đổi tài xế-xe" chặn gán biển số đã dùng cho 1 chuyến APPROVED KHÁC trùng khung giờ (409)', !f7a.ok, JSON.stringify(f7a));

  // F7b — carDispatch đổi tài xế + loại xe + biển số (biển mới, KHÔNG trùng) hợp lệ.
  const f7b = await page.evaluate(async (carId) => {
    const result = await callRecordAction('carRegs', carId, 'reassign', {
      assignedDriverUsername: 'lx2', assignedVehicleType: 'Xe 16 chỗ', assignedPlate: '51A-444.44',
      comment: 'Đổi tài xế do lx1 bận đột xuất'
    });
    const idx = DB.carRegs.findIndex((c) => c.id === carId);
    DB.carRegs[idx] = result.item;
    return result.item;
  }, carF2.id);
  record(
    'Fix 4: carDispatch đổi tài xế-xe thành công trên 1 chuyến đã APPROVED (driver/loại xe/biển số mới)',
    f7b.assignedDriverUsername === 'lx2' && f7b.assignedPlate === '51A-444.44' && f7b.assignedVehicleType === 'Xe 16 chỗ',
    JSON.stringify(f7b)
  );
  record(
    'Fix 4: đổi sang tài xế KHÁC reset xác nhận cũ của lái xe trước (mirror applyWorkflowAction())',
    f7b.driverConfirmed === false && f7b.driverConfirmedAt === null,
    JSON.stringify(f7b)
  );
  record('Fix 4: "Đổi tài xế-xe" ghi đúng dòng lịch sử REASSIGNED', (f7b.history || []).some((h) => h.action === 'REASSIGNED'), JSON.stringify(f7b.history));

  // F8 — "Đổi tài xế-xe" bị chặn trên chuyến KHÔNG còn APPROVED nữa (vd đã CANCELLED — carF1 từ F2).
  const f8 = await page.evaluate(async (carId) => {
    try { await callRecordAction('carRegs', carId, 'reassign', { assignedPlate: '51A-555.55' }); return { ok: true }; }
    catch (err) { return { ok: false, message: err.message }; }
  }, carF1.id);
  record('Fix 4: "Đổi tài xế-xe" bị chặn trên chuyến KHÔNG còn APPROVED (vd đã CANCELLED) (409)', !f8.ok, JSON.stringify(f8));

  // F9 — UI gating: dòng danh sách + modal xử lý hiện ĐÚNG 2 nút cho carDispatch (Đổi Tài Xế-Xe + Hủy
  // Chuyến), CHỈ 1 nút Hủy Chuyến cho chính người tạo (không có carDispatch), và KHÔNG nút nào cho
  // canCancelCarRegClient()/canDispatchCarClient() trả false (mirror chính xác gate server ở trên).
  const f9dispatch = await (async () => {
    await loginAs(page, dispatchApproverUser);
    return page.evaluate(({ carId }) => {
      switchTab('car');
      // Lọc theo từ khóa mã phiếu — tránh phiếu F9 (tạo cuối cùng) rơi ra ngoài trang hiện tại của
      // pagination do danh sách carRegs đã tích lũy rất nhiều bản ghi qua các scenario trước đó trong
      // cùng file test này (mirror đúng cách người dùng thật lọc theo mã phiếu, ổn định hơn giả định
      // "trang 1 luôn có").
      document.getElementById('filterKeywordCar').value = 'HCRC-DPH-F9';
      renderCarRegs();
      const row = [...document.querySelectorAll('#carTableBody tr')].find((tr) => tr.textContent.includes('HCRC-DPH-F9'));
      openCarProcessModal(carId);
      const modalBtnsHtml = document.getElementById('carModalActionBtns').innerHTML;
      closeCarProcessModal();
      return { rowHtml: row ? row.innerHTML : null, modalBtnsHtml };
    }, { carId: carF9.id });
  })();
  record(
    'Fix 4 UI: carDispatch thấy CẢ 2 lựa chọn "Đổi Tài Xế-Xe"(reassign)/"Hủy Chuyến"(cancelTrip) ở dòng danh sách',
    f9dispatch.rowHtml && f9dispatch.rowHtml.includes('value="reassign"') && f9dispatch.rowHtml.includes('value="cancelTrip"'),
    JSON.stringify(f9dispatch.rowHtml)
  );
  record(
    'Fix 4 UI: carDispatch thấy CẢ 2 nút trong modal xử lý (confirmCarReassign + openCancelCarRegModal)',
    f9dispatch.modalBtnsHtml.includes('confirmCarReassign') && f9dispatch.modalBtnsHtml.includes('openCancelCarRegModal'),
    JSON.stringify(f9dispatch.modalBtnsHtml)
  );

  await loginAs(page, bookerUser);
  const f9booker = await page.evaluate(({ carId }) => {
    switchTab('car');
    renderCarRegs();
    const row = [...document.querySelectorAll('#carTableBody tr')].find((tr) => tr.textContent.includes('HCRC-DPH-F9'));
    openCarProcessModal(carId);
    const modalBtnsHtml = document.getElementById('carModalActionBtns').innerHTML;
    closeCarProcessModal();
    return { rowHtml: row ? row.innerHTML : null, modalBtnsHtml };
  }, { carId: carF9.id });
  record(
    'Fix 4 UI: chính người tạo (KHÔNG carDispatch) chỉ thấy "Hủy Chuyến", KHÔNG thấy "Đổi Tài Xế-Xe"',
    f9booker.rowHtml && f9booker.rowHtml.includes('value="cancelTrip"') && !f9booker.rowHtml.includes('value="reassign"'),
    JSON.stringify(f9booker.rowHtml)
  );
  record(
    'Fix 4 UI: modal của chính người tạo chỉ có nút Hủy Chuyến, không có Đổi Tài Xế-Xe',
    f9booker.modalBtnsHtml.includes('openCancelCarRegModal') && !f9booker.modalBtnsHtml.includes('confirmCarReassign'),
    JSON.stringify(f9booker.modalBtnsHtml)
  );

  await loginAs(page, noDispatchApproverUser);
  const f9outsider = await page.evaluate(({ carId }) => {
    const car = DB.carRegs.find((c) => c.id === carId);
    return { canCancel: canCancelCarRegClient(car), canDispatch: canDispatchCarClient() };
  }, { carId: carF9.id });
  record(
    'Fix 4 UI: người KHÔNG phải chủ chuyến và KHÔNG có carDispatch -> canCancelCarRegClient()/canDispatchCarClient() đều false',
    f9outsider.canCancel === false && f9outsider.canDispatch === false,
    JSON.stringify(f9outsider)
  );

  // ===================== "Lịch Xe" READ-ONLY CALENDAR (renderCarScheduleCalendar(), sub-tab CALENDAR,
  // xem module-dangkyxe.js) — mirror khuôn Lịch Họp (renderMeetingCalendar()) nhưng KHÔNG có tương tác
  // đặt lịch/kéo chọn (phương án chỉ-xem đã xác nhận với người dùng). IDs 900501-900505 và các ngày
  // 2026-10-01..12 CHỈ dùng riêng cho cụm test này — không trùng bất kỳ id/ngày nào các test C*/D*/F*
  // ở trên đã dùng (900001-900409, ngày 2026-09-01..24). =====================
  const calPendingTrip = {
    id: 900501, code: 'HCRC-DPH-CAL-PENDING', dept: 'Phòng Kinh Doanh', status: 'PENDING', currentStep: 1, history: [],
    assignedDriverUsername: 'lx2', assignedDriver: 'Trần Văn Lái',
    startTime: '2026-10-01T09:00', endTime: '2026-10-01T10:00', destination: 'HN → Test Lịch Xe (PENDING)'
  };
  const calDraftTrip = {
    id: 900502, code: 'HCRC-DPH-CAL-DRAFT', dept: 'Phòng Kinh Doanh', status: 'DRAFT', currentStep: 1, history: [],
    assignedDriverUsername: 'lx2', assignedDriver: 'Trần Văn Lái',
    startTime: '2026-10-02T09:00', endTime: '2026-10-02T10:00', destination: 'HN → Test Lịch Xe (DRAFT)'
  };
  const calRejectedTrip = {
    id: 900503, code: 'HCRC-DPH-CAL-REJECTED', dept: 'Phòng Kinh Doanh', status: 'REJECTED', currentStep: 1, history: [],
    assignedDriverUsername: 'lx2', assignedDriver: 'Trần Văn Lái',
    startTime: '2026-10-03T09:00', endTime: '2026-10-03T10:00', destination: 'HN → Test Lịch Xe (REJECTED)'
  };
  const calCancelledTrip = {
    id: 900504, code: 'HCRC-DPH-CAL-CANCELLED', dept: 'Phòng Kinh Doanh', status: 'CANCELLED', currentStep: 1, history: [],
    assignedDriverUsername: 'lx2', assignedDriver: 'Trần Văn Lái',
    startTime: '2026-10-04T09:00', endTime: '2026-10-04T10:00', destination: 'HN → Test Lịch Xe (CANCELLED)'
  };
  // Chuyến dài ngày (2026-10-10 10:00 -> 2026-10-12 15:00) — phải hiện đỏ ở CẢ 3 ngày, kể cả ngày GIỮA
  // (2026-10-11) không phải ngày bắt đầu/kết thúc — xác nhận overlap tính bằng Date đầy đủ chứ không chỉ
  // giờ-trong-ngày.
  const calMultiDayTrip = {
    id: 900505, code: 'HCRC-DPH-CAL-MULTIDAY', dept: 'Phòng Kinh Doanh', status: 'APPROVED', currentStep: 1, history: [],
    assignedDriverUsername: 'lx1', assignedDriver: 'Nguyễn Văn Tài',
    startTime: '2026-10-10T10:00', endTime: '2026-10-12T15:00', destination: 'HN → Đà Nẵng (công tác dài ngày)'
  };
  store.carRegs.push(calPendingTrip, calDraftTrip, calRejectedTrip, calCancelledTrip, calMultiDayTrip);
  await page.evaluate((items) => { items.forEach((c) => DB.carRegs.push(c)); },
    [calPendingTrip, calDraftTrip, calRejectedTrip, calCancelledTrip, calMultiDayTrip]);

  // Helper trong trang: mở sub-tab Lịch Xe, render đúng 1 ngày, trả về trạng thái ô [driverUsername, slot].
  const readCarCalCell = (dateStr, username, slot) => page.evaluate(({ dateStr, username, slot }) => {
    switchTab('car');
    setCarSubTab('CALENDAR');
    document.getElementById('carCalDate').value = dateStr;
    renderCarScheduleCalendar();
    const drivers = DB.users.filter((u) => u.active !== false && u.isDriver);
    const colIdx = drivers.findIndex((d) => d.username === username);
    if (colIdx === -1) return { found: false, reason: 'driver not in calendar columns' };
    const rowIdx = generateCarTimeSlots().indexOf(slot);
    if (rowIdx === -1) return { found: false, reason: 'slot not found' };
    const grid = document.getElementById('carCalendarGrid');
    const row = grid.querySelectorAll('tbody tr')[rowIdx];
    const cell = row.querySelectorAll('td')[1 + colIdx]; // cột 0 = Giờ
    return {
      found: true,
      isRed: cell.classList.contains('bg-red-500'),
      isWhite: cell.classList.contains('bg-white'),
      carId: cell.dataset.carId || null
    };
  }, { dateStr, username, slot });

  const calA = await readCarCalCell('2026-10-01', 'lx2', '09:00');
  record(
    'Lịch Xe: lái xe có phiếu PENDING trùng khung giờ hiện Ô ĐỎ (đang bận)',
    calA.found && calA.isRed && Number(calA.carId) === calPendingTrip.id,
    JSON.stringify(calA)
  );
  const calA2 = await readCarCalCell('2026-10-01', 'lx2', '08:00');
  record(
    'Lịch Xe: cùng ngày nhưng NGOÀI khung giờ có phiếu — ô trắng (còn trống)',
    calA2.found && calA2.isWhite,
    JSON.stringify(calA2)
  );

  const calB = await readCarCalCell('2026-10-02', 'lx2', '09:00');
  record(
    'Lịch Xe: phiếu DRAFT ("cần bổ sung — chờ sửa lại") cũng tính là đang bận — ô đỏ (khớp quy ước findCarPlateConflict())',
    calB.found && calB.isRed && Number(calB.carId) === calDraftTrip.id,
    JSON.stringify(calB)
  );

  const calC = await readCarCalCell('2026-10-03', 'lx2', '09:00');
  record(
    'Lịch Xe: phiếu REJECTED KHÔNG tính là đang bận — ô trắng',
    calC.found && calC.isWhite,
    JSON.stringify(calC)
  );

  const calD = await readCarCalCell('2026-10-04', 'lx2', '09:00');
  record(
    'Lịch Xe: phiếu CANCELLED KHÔNG tính là đang bận — ô trắng',
    calD.found && calD.isWhite,
    JSON.stringify(calD)
  );

  const calE1 = await readCarCalCell('2026-10-10', 'lx1', '12:00'); // ngày bắt đầu chuyến, sau giờ khởi hành 10:00
  const calE2 = await readCarCalCell('2026-10-11', 'lx1', '12:00'); // ngày GIỮA — không phải ngày bắt đầu/kết thúc
  const calE3 = await readCarCalCell('2026-10-12', 'lx1', '12:00'); // ngày kết thúc chuyến, trước giờ về 15:00
  record(
    'Lịch Xe: chuyến nhiều ngày hiện đỏ đúng ở ngày bắt đầu',
    calE1.found && calE1.isRed && Number(calE1.carId) === calMultiDayTrip.id,
    JSON.stringify(calE1)
  );
  record(
    'Lịch Xe: chuyến nhiều ngày hiện đỏ ở ngày GIỮA (không phải ngày bắt đầu/kết thúc) — overlap tính đúng qua nhiều ngày',
    calE2.found && calE2.isRed && Number(calE2.carId) === calMultiDayTrip.id,
    JSON.stringify(calE2)
  );
  record(
    'Lịch Xe: chuyến nhiều ngày hiện đỏ đúng ở ngày kết thúc',
    calE3.found && calE3.isRed && Number(calE3.carId) === calMultiDayTrip.id,
    JSON.stringify(calE3)
  );

  const calE0 = await readCarCalCell('2026-10-10', 'lx1', '07:00'); // trước giờ khởi hành (10:00) cùng ngày bắt đầu
  const calE4 = await readCarCalCell('2026-10-12', 'lx1', '18:30'); // sau giờ về (15:00) cùng ngày kết thúc
  record('Lịch Xe: trước giờ khởi hành của ngày đầu chuyến — ô trắng (đúng biên đầu khoảng)', calE0.found && calE0.isWhite, JSON.stringify(calE0));
  record('Lịch Xe: sau giờ về của ngày cuối chuyến — ô trắng (đúng biên cuối khoảng)', calE4.found && calE4.isWhite, JSON.stringify(calE4));

  // Bấm ô đỏ chỉ hiện thông tin qua alert() (showCarScheduleSlotInfo) — KHÔNG chuyển sang tab/form đăng ký
  // (đúng phương án chỉ-xem đã xác nhận, khác hẳn quickBookMeetingSlot() của Lịch Họp).
  const calClick = await page.evaluate((carId) => {
    window.__alerts = [];
    document.getElementById('carCalDate').value = '2026-10-01';
    renderCarScheduleCalendar();
    const cell = document.querySelector(`.car-cal-cell[data-car-id="${carId}"]`);
    if (cell) cell.click();
    return {
      alerts: window.__alerts.slice(),
      stillOnCalendarTab: !document.getElementById('carSubCalendar').classList.contains('hidden'),
      stillOnRegTab: document.getElementById('carSubReg').classList.contains('hidden')
    };
  }, calPendingTrip.id);
  record(
    'Lịch Xe: bấm ô đỏ hiện thông tin phiếu qua alert(), vẫn ở lại tab Lịch Xe — không nhảy sang form Đăng Ký (khác Lịch Họp)',
    calClick.alerts.some((a) => a.includes('HCRC-DPH-CAL-PENDING')) && calClick.stillOnCalendarTab && calClick.stillOnRegTab,
    JSON.stringify(calClick)
  );

  await browser.close();
  server.close();

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
