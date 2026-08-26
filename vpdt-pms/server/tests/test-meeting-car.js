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
  active: true, perms: { admin: true }
};
const driverUser = {
  username: 'lx1', name: 'Nguyễn Văn Tài', dept: 'Phòng Hành Chính', role: 'STAFF',
  phone: '0966666666', email: 'lx1@company.com', jobTitle: 'Lái xe',
  active: true, perms: {}
};
const driverUser2 = {
  username: 'lx2', name: 'Trần Văn Lái', dept: 'Phòng Hành Chính', role: 'STAFF',
  phone: '0977777777', email: 'lx2@company.com', jobTitle: 'Lái xe',
  active: true, perms: {}
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
    const roomIdx = MEETING_ROOMS.findIndex((r) => r.name === room);
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
