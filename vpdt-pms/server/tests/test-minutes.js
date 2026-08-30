// tests/test-minutes.js — Regression suite for module "Biên Bản Họp" (Meeting Minutes, DB key `minutes`).
//
// WHY THIS FILE LOOKS THE WAY IT DOES (read before editing):
//   This sandbox has no real SQL Server, so `node server.js` cannot run for real. Instead of stubbing
//   every fetch() call to a dumb no-op (which would make "does the server correctly reject X" scenarios
//   untestable), this suite spins up a tiny local http.createServer that (a) serves the real
//   server/public/index.html unmodified, and (b) implements JUST the handful of /api/records/minutes*
//   routes this module actually calls — but instead of hand-rolling that business logic, it directly
//   requires the REAL server module `../lib/recordActions.js` (createMinutes/editMinutes/
//   assignMinutesTasks/assertCanDeleteMinutes) — the exact same code routes/records.js calls in
//   production. So permission checks, "biên bản đã Giao việc thì khoá sửa" locking, and Task-building
//   from directives are all exercised through the real implementation, not a re-guess of it. Only the
//   SQL-backed storage layer (lib/recordStore.js) is swapped for a plain in-memory array, and only the
//   HTTP auth layer is swapped for a Node-side "activeServerUser" variable the test sets directly.
//
// Browser side: window.confirm/alert/prompt are stubbed (headless Chromium can't answer native dialogs
// synchronously) and alerts are captured into window.__alerts for assertions. DB collections are seeded
// directly (bypassing initDatabase()/proceedAfterAuth()), then finishLogin(user) is called exactly like
// a real successful login would, per the proven pattern for this app.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const recordActions = require('../lib/recordActions');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8971;

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`);
}

// ===================== In-memory "server" state =====================
const store = {
  meetingMinutes: [],
  tasks: []
};
let activeServerUser = null; // set by the test before each phase — stands in for the authenticated session

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let chunks = '';
    req.on('data', (c) => { chunks += c; });
    req.on('end', () => {
      try { resolve(chunks ? JSON.parse(chunks) : {}); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/records/minutes') {
    const body = await readBody(req);
    try {
      const item = recordActions.createMinutes(body, activeServerUser, store.meetingMinutes);
      store.meetingMinutes.push(item);
      return sendJson(res, 200, { ok: true, item });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  const editMatch = url.pathname.match(/^\/api\/records\/minutes\/(\d+)\/edit$/);
  if (req.method === 'POST' && editMatch) {
    const id = Number(editMatch[1]);
    const body = await readBody(req);
    const idx = store.meetingMinutes.findIndex((m) => m.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'Không tìm thấy hồ sơ' });
    try {
      const { directiveIdMigrations, ...updated } = recordActions.editMinutes(body, activeServerUser, store.meetingMinutes[idx]);
      store.meetingMinutes[idx] = updated;
      return sendJson(res, 200, { ok: true, item: updated });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  const assignMatch = url.pathname.match(/^\/api\/records\/minutes\/(\d+)\/assign-tasks$/);
  if (req.method === 'POST' && assignMatch) {
    const id = Number(assignMatch[1]);
    const idx = store.meetingMinutes.findIndex((m) => m.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'Không tìm thấy hồ sơ' });
    try {
      const item = store.meetingMinutes[idx];
      // Tham số thứ 3 (danh sách user) là BẮT BUỘC từ bản vá "người tham dự có hasAccount:'YES' phải
      // là tài khoản đang hoạt động có thật" — route thật truyền req.allUsers xuống, mock backend này
      // truyền đúng danh sách user đã seed vào DB trình duyệt (xem seedDB.users bên dưới).
      const createdTasks = recordActions.assignMinutesTasks(activeServerUser, item, seedDB.users);
      createdTasks.forEach((c) => store.tasks.push(c.item));
      return sendJson(res, 200, { ok: true, item, createdTasks });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  const deleteMatch = url.pathname.match(/^\/api\/records\/minutes\/(\d+)\/delete$/);
  if (req.method === 'POST' && deleteMatch) {
    const id = Number(deleteMatch[1]);
    const idx = store.meetingMinutes.findIndex((m) => m.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'Không tìm thấy hồ sơ' });
    try {
      recordActions.assertCanDeleteMinutes(activeServerUser, store.meetingMinutes[idx]);
      store.meetingMinutes.splice(idx, 1);
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.message });
    }
  }

  // Anything else the page happens to call (session keepalive, logging, etc.) — harmless no-op 200.
  sendJson(res, 200, {});
});

// ===================== Fixtures =====================
const secretaryUser = {
  username: 'thuky1', name: 'Đặng Thị Ký', dept: 'Phòng Hành Chính', role: 'STAFF',
  phone: '0911111111', email: 'ky@company.com', jobTitle: 'Thư ký',
  active: true, perms: { minutesCreate: true }
};
const directorUser = {
  username: 'gdA', name: 'Nguyễn Văn Giám Đốc', dept: 'Ban Giám Đốc',
  phone: '0922222222', email: 'gd@company.com', jobTitle: 'Giám Đốc',
  active: true, perms: {}
};

const seedDB = {
  depts: ['Phòng Hành Chính', 'Ban Giám Đốc', 'Phòng Kinh Doanh'],
  cats: [], stores: [],
  jobTitles: ['Thư ký', 'Giám Đốc', 'Nhân viên'],
  submissionTypes: [], contractTypes: [], carTypes: [],
  users: [secretaryUser, directorUser],
  meetings: [],
  meetingAttendeeTemplates: [],
  meetingMinutes: [],
  tasks: [],
  permGroups: [],
  vppExcludeGroups: [],
  vppPeriods: [], vppRegistrations: [], vppDeptWorkflows: {},
  carDeptWorkflows: {},
  budgetEntries: [], budgetDeptWorkflows: {},
  itPriceApprovals: [], itPriceDeptWorkflows: {},
  _versions: {}
};

async function main() {
  await new Promise((resolve) => server.listen(PORT, resolve));

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', headless: true });
  const page = await browser.newPage();
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));
  await page.goto(`http://localhost:${PORT}/`);

  // ---- Boot: stub dialogs, seed DB, log in as the secretary who lập biên bản ----
  activeServerUser = secretaryUser;
  await page.evaluate(({ seedDB, secretaryUser }) => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => window.__promptAnswer;
    Object.assign(DB, seedDB);
    finishLogin(secretaryUser);
    switchTab('minutes');
  }, { seedDB, secretaryUser });

  // ===================== Scenario 1: happy-path create with attendee account autocomplete =====================
  const s1 = await page.evaluate(async ({ directorUsername, directorFullLabel }) => {
    window.__alerts = [];
    document.getElementById('minutesTitle').value = 'Họp giao ban tuần 34';
    document.getElementById('minutesTime').value = '2026-08-25T09:00';
    document.getElementById('minutesLocation').value = 'Phòng họp A';
    document.getElementById('minutesChair').value = 'Nguyễn Văn Giám Đốc';
    document.getElementById('minutesSecretary').value = 'Đặng Thị Ký';
    document.getElementById('minutesContent').value = 'Rà soát tiến độ các dự án đang triển khai.';

    addAttendeeRow(); // attendee 0 — sẽ gắn tài khoản hệ thống qua datalist
    addAttendeeRow(); // attendee 1 — khách mời ngoài, không có tài khoản

    // Mô phỏng đúng luồng thật: bật "Tài khoản = Có" trước, rồi chọn gợi ý datalist (đúng định dạng
    // "Tên — Phòng (username)" do populateSystemUsersDatalist() sinh ra) — kích hoạt
    // resolveAttendeeAccountInput() tự điền Chức danh/Phòng/SĐT/Email.
    toggleAttendeeHasAccount(0, 'YES');
    resolveAttendeeAccountInput(0, directorFullLabel);

    updateAttendeeField(1, 'name', 'Khách Mời Ngoài Công Ty');
    updateAttendeeField(1, 'title', 'Đối tác');
    updateAttendeeField(1, 'phone', '0900000000');
    updateAttendeeField(1, 'email', 'guest@example.com');

    const attendee0AfterAutofill = { ...minutesAttendeesRows[0] };

    addMinutesDirectiveRow();
    updateMinutesDirectiveField(0, 'content', 'Chuẩn bị báo cáo quý 3');
    updateMinutesDirectiveField(0, 'assignedToAttendeeId', minutesAttendeesRows[0].id);
    updateMinutesDirectiveField(0, 'deadline', '2026-09-15');

    const codeBefore = document.getElementById('minutesCode').value;
    const form = document.getElementById('minutesForm');
    await submitMeetingMinutes({ preventDefault() {}, target: form });

    return {
      alerts: window.__alerts.slice(),
      code: codeBefore,
      minutesCount: DB.meetingMinutes.length,
      savedCode: DB.meetingMinutes[0] && DB.meetingMinutes[0].code,
      savedId: DB.meetingMinutes[0] && DB.meetingMinutes[0].id,
      attendee0AfterAutofill,
      emailModalHidden: document.getElementById('minutesEmailComposeModal').classList.contains('hidden'),
      emailRecipientsHTML: document.getElementById('minutesEmailRecipientsList').innerHTML
    };
  }, {
    directorUsername: directorUser.username,
    directorFullLabel: `${directorUser.name} — ${directorUser.dept} (${directorUser.username})`
  });

  record(
    'Minutes: happy-path create — record saved with generated code',
    s1.minutesCount === 1 && s1.savedCode === s1.code,
    `alerts=${JSON.stringify(s1.alerts)} savedCode=${s1.savedCode} expectedCode=${s1.code}`
  );
  record(
    'Minutes: attendee "Tài khoản=Có" datalist pick auto-fills chức danh/phòng/SĐT/email',
    s1.attendee0AfterAutofill.username === directorUser.username &&
    s1.attendee0AfterAutofill.title === directorUser.jobTitle &&
    s1.attendee0AfterAutofill.dept === directorUser.dept &&
    s1.attendee0AfterAutofill.phone === directorUser.phone &&
    s1.attendee0AfterAutofill.email === directorUser.email,
    `attendee0=${JSON.stringify(s1.attendee0AfterAutofill)}`
  );
  record(
    'Minutes: save success opens email compose modal listing attendees with emails',
    s1.emailModalHidden === false &&
    s1.emailRecipientsHTML.includes('Nguyễn Văn Giám Đốc') &&
    s1.emailRecipientsHTML.includes('Khách Mời Ngoài Công Ty'),
    `modalHidden=${s1.emailModalHidden}`
  );

  // ===================== Scenario 2: attendee template save / apply / delete =====================
  const s2 = await page.evaluate(async () => {
    window.__alerts = [];
    window.__promptAnswer = 'Họp giao ban tuần';

    // submitMeetingMinutes() thành công ở kịch bản 1 đã tự xoá trắng form (đúng hành vi thật) — dựng lại
    // 1 danh sách tham dự mới trên form trước khi lưu thành mẫu.
    minutesAttendeesRows = [];
    addAttendeeRow();
    addAttendeeRow();
    updateAttendeeField(0, 'name', 'Nguyễn Văn Giám Đốc');
    updateAttendeeField(1, 'name', 'Khách Mời Ngoài Công Ty');

    saveMeetingAttendeeTemplate(); // lưu chính danh sách 2 người tham dự đang có trong form
    const afterSave = DB.meetingAttendeeTemplates.length;
    const tplId = DB.meetingAttendeeTemplates[0] && DB.meetingAttendeeTemplates[0].id;
    const savedAttendeeCount = DB.meetingAttendeeTemplates[0] && DB.meetingAttendeeTemplates[0].attendees.length;

    // Xoá sạch danh sách tham dự trên form rồi Áp Dụng lại mẫu vừa lưu — phải khôi phục đúng 2 người.
    minutesAttendeesRows = [];
    renderAttendeesTable();
    applyMeetingAttendeeTemplate(tplId);
    const afterApplyCount = minutesAttendeesRows.length;
    const afterApplyNames = minutesAttendeesRows.map((a) => a.name).sort();

    document.getElementById('minutesAttendeeTemplateSelect').value = tplId;
    deleteMeetingAttendeeTemplate();
    const afterDeleteCount = DB.meetingAttendeeTemplates.length;

    return { afterSave, savedAttendeeCount, afterApplyCount, afterApplyNames, afterDeleteCount };
  });

  record(
    'Minutes: save attendee list as a reusable template',
    s2.afterSave === 1 && s2.savedAttendeeCount === 2,
    `afterSave=${s2.afterSave} savedAttendeeCount=${s2.savedAttendeeCount}`
  );
  record(
    'Minutes: apply template repopulates the attendee list',
    s2.afterApplyCount === 2 &&
    s2.afterApplyNames.includes('Nguyễn Văn Giám Đốc') &&
    s2.afterApplyNames.includes('Khách Mời Ngoài Công Ty'),
    `afterApplyNames=${JSON.stringify(s2.afterApplyNames)}`
  );
  record(
    'Minutes: delete template removes it from the saved list',
    s2.afterDeleteCount === 0,
    `afterDeleteCount=${s2.afterDeleteCount}`
  );

  // ===================== Scenario 3: rejection — duplicate mã biên bản =====================
  const s3 = await page.evaluate(async (existingCode) => {
    window.__alerts = [];
    document.getElementById('minutesCode').readOnly = false; // mô phỏng 1 request/áp lực trùng mã bất thường
    document.getElementById('minutesCode').value = existingCode;
    document.getElementById('minutesTitle').value = 'Họp trùng mã (phải bị từ chối)';
    document.getElementById('minutesTime').value = '2026-08-26T09:00';
    document.getElementById('minutesChair').value = 'Ai đó';
    document.getElementById('minutesSecretary').value = 'Ai đó';
    document.getElementById('minutesContent').value = 'Nội dung bất kỳ';
    minutesAttendeesRows = [];
    minutesDirectives = [];
    renderAttendeesTable();
    renderMinutesDirectivesTable();

    const countBefore = DB.meetingMinutes.length;
    const form = document.getElementById('minutesForm');
    await submitMeetingMinutes({ preventDefault() {}, target: form });
    return { alerts: window.__alerts.slice(), countBefore, countAfter: DB.meetingMinutes.length };
  }, s1.savedCode);

  record(
    'Minutes: duplicate mã biên bản is rejected client-side before any save',
    s3.alerts.some((a) => a.includes('Mã biên bản đã tồn tại')) && s3.countAfter === s3.countBefore,
    `alerts=${JSON.stringify(s3.alerts)} countBefore=${s3.countBefore} countAfter=${s3.countAfter}`
  );

  // ===================== Scenario 4: "Giao việc" (assign tasks) locks the record and creates a Task =====================
  const s4 = await page.evaluate(async (minutesId) => {
    window.__alerts = [];
    const tasksBefore = DB.tasks.length;
    await assignMinutesTasksAction(minutesId);
    const m = DB.meetingMinutes.find((x) => x.id === minutesId);
    const newTask = DB.tasks[0];

    // Người tạo (không phải admin) thử Sửa lại biên bản đã khoá — phải bị chặn ngay ở client.
    editingMinutesId = null;
    openEditMeetingMinutes(minutesId);

    return {
      alerts: window.__alerts.slice(),
      tasksBefore, tasksAfter: DB.tasks.length,
      tasksAssigned: m.tasksAssigned,
      taskAssignedToUsername: newTask && newTask.assignedTo,
      taskAssignedToName: newTask && newTask.assignedToName,
      taskDescription: newTask && newTask.description,
      taskStatus: newTask && newTask.status,
      stillNotEditing: editingMinutesId === null
    };
  }, s1.savedId);

  record(
    'Minutes: "Giao việc" creates exactly 1 Task from the assigned directive',
    s4.tasksAfter === s4.tasksBefore + 1 &&
    s4.taskAssignedToUsername === directorUser.username &&
    s4.taskAssignedToName === directorUser.name &&
    s4.taskDescription === 'Chuẩn bị báo cáo quý 3' &&
    s4.taskStatus === 'DOING',
    `task=${JSON.stringify({ u: s4.taskAssignedToUsername, n: s4.taskAssignedToName, s: s4.taskStatus })}`
  );
  record(
    'Minutes: record is locked (tasksAssigned) and further edit by the creator is blocked',
    s4.tasksAssigned === true &&
    s4.stillNotEditing &&
    s4.alerts.some((a) => a.includes('không có quyền sửa')),
    `tasksAssigned=${s4.tasksAssigned} alerts=${JSON.stringify(s4.alerts)}`
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
