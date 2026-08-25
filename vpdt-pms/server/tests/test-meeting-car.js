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

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8972;

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

// ===================== In-memory "server" state =====================
const store = { meetings: [], carRegs: [] };
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

  // POST /api/workflow/carRegs/:id/approve|reject — the exact engine routes/workflow.js calls.
  const workflowMatch = url.pathname.match(/^\/api\/workflow\/carRegs\/(\d+)\/(approve|reject)$/);
  if (req.method === 'POST' && workflowMatch) {
    const id = Number(workflowMatch[1]);
    const rawAction = workflowMatch[2];
    const body = await readBody(req);
    const item = store.carRegs.find((c) => c.id === id);
    if (!item) return sendJson(res, 404, { error: 'Không tìm thấy hồ sơ' });
    try {
      const outcome = applyWorkflowAction({
        moduleKey: 'carRegs', item, action: rawAction === 'approve' ? 'APPROVE' : 'REJECT',
        user: activeServerUser, comment: body.comment, extraFields: body.extraFields,
        appData: { carDeptWorkflows: {}, workflows: [] },
        existingCollection: store.carRegs
      });
      return sendJson(res, 200, { ok: true, item: outcome.item, transition: outcome.transition });
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

const ROOM = 'Phòng Họp Lớn A (Tầng 3 - Sức chứa 50 người)';

const seedDB = {
  depts: ['Phòng Kinh Doanh', 'Phòng Hành Chính', 'Ban Giám Đốc'],
  cats: [], stores: [],
  jobTitles: ['Nhân viên', 'Quản lý phòng họp', 'Admin'],
  submissionTypes: [], contractTypes: [],
  carTypes: ['Xe 4 chỗ', 'Xe 7 chỗ', 'Xe 16 chỗ'],
  users: [bookerUser, roomManagerUser, adminUser],
  meetings: [], meetingMinutes: [], meetingAttendeeTemplates: [],
  carRegs: [], carDeptWorkflows: {},
  tasks: [], permGroups: [], vppExcludeGroups: [],
  vppPeriods: [], vppRegistrations: [], vppDeptWorkflows: {},
  budgetEntries: [], budgetDeptWorkflows: {},
  itPriceApprovals: [], itPriceDeptWorkflows: {},
  _versions: {}
};

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
    document.getElementById('carDestination').value = 'HN -> Hải Phòng -> HN';
    document.getElementById('carReason').value = 'Gặp đối tác ký hợp đồng.';
    const form = document.querySelector('#carSection form');
    await submitCarReq({ preventDefault() {}, target: form });
    return { alerts: window.__alerts.slice(), count: DB.carRegs.length, saved: DB.carRegs[0] };
  });

  record(
    'Car: happy-path registration saved as PENDING step 1',
    c1.count === 1 && c1.saved.status === 'PENDING' && c1.saved.currentStep === 1,
    `count=${c1.count} status=${c1.saved && c1.saved.status} alerts=${JSON.stringify(c1.alerts)}`
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
    document.getElementById('carDestination').value = 'HN -> Bắc Ninh -> HN';
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
    document.getElementById('carAssignedDriver').value = 'Nguyễn Văn Tài';
    document.getElementById('carAssignedVehicleType').value = 'Toyota Innova 7 chỗ';
    document.getElementById('carAssignedPlate').value = '30F-123.45';
    document.getElementById('txtCarComment').value = '';
    await processCarReg('APPROVE');
    const item = DB.carRegs.find((c) => c.id === carId);
    return { alerts: window.__alerts.slice(), status: item.status, plate: item.assignedPlate };
  }, c1.saved.id);

  record(
    'Car: admin approves and assigns plate — single-step workflow completes',
    c3.status === 'APPROVED' && c3.plate === '30F-123.45',
    `status=${c3.status} plate=${c3.plate} alerts=${JSON.stringify(c3.alerts)}`
  );

  // Duyệt phiếu 2, cố gán TRÙNG biển số 30F-123.45 trong khung giờ chồng lấn với phiếu 1 -> phải bị chặn.
  const c4 = await page.evaluate(async (carId) => {
    window.__alerts = [];
    currentProcessingCarId = carId;
    document.getElementById('carAssignedDriver').value = 'Trần Văn Lái';
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
