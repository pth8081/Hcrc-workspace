// server/tests/test-audit-round2-cluster4.js
//
// Regression test cho ĐỢT 2 rà soát bảo mật — CỤM 4 (Đăng Ký Xe / Phòng Họp / Biên Bản Họp / Công
// Việc). Mỗi kịch bản gắn với ĐÚNG 1 lỗ hổng đã vá, viết sao cho hoàn tác bản vá là FAIL ngay:
//
//   1. meetingAttendeeTemplates KHÔNG nằm trong ADMIN_ONLY_KEYS và cũng KHÔNG có gate nào khác ->
//      BẤT KỲ tài khoản đã đăng nhập nào cũng ghi đè/xoá sạch toàn bộ "Mẫu Danh Sách Tham Dự" dùng
//      chung của cả công ty qua POST /api/data/meetingAttendeeTemplates (routes/data.js). Bản vá KHÔNG
//      phải là đưa vào ADMIN_ONLY_KEYS (sẽ phá tính năng chia sẻ mẫu giữa những người lập biên bản) mà
//      là 1 gate hẹp riêng: admin || minutesCreate || minutesEdit.
//   2. createTask() trải NGUYÊN payload client (`{...payload, id}`) rồi chỉ ghi đè vài field danh tính
//      -> người có taskEdit tự soạn request đặt status:'DONE' (việc hoàn thành khống, chưa từng qua
//      Nhận Việc) hoặc sourceType/sourceCode trỏ tới 1 hồ sơ CÓ THẬT mà việc này không hề sinh ra từ đó
//      (lib/recordActions.js).
//   3. Người tham dự biên bản khai hasAccount:'YES' -> a.username được tin tuyệt đối khi biến thành
//      người nhận việc: sinh Công Việc gán cho tài khoản không tồn tại/đã khoá (mồ côi vĩnh viễn), hoặc
//      cho 1 nhân viên có thật không hề dự họp (lib/recordActions.js resolveDirectiveAttendeeServer/
//      buildTasksFromDirectives/assignMinutesTasks).
//   4. assignTask()/editTask() chỉ kiểm "assignedTo là chuỗi khác rỗng", không đối chiếu danh sách user
//      đang hoạt động — cùng hậu quả mồ côi như (3) (lib/recordActions.js).
//   5. editTask() rút ngắn task.deadline xuống DƯỚI dueDate của subtask đã tồn tại — addSubtask() chỉ
//      kiểm ràng buộc này lúc TẠO subtask (lib/recordActions.js).
//   6. requestExtension() ÂM THẦM ghi đè 1 pendingExtension chưa ai duyệt (nhánh xin huỷ ở
//      cancelOrRequestCancelTask() đã chặn, nhánh xin gia hạn thì không) (lib/recordActions.js).
//   7. carRegs REQUEST_CHANGES đưa phiếu về DRAFT nhưng GIỮ NGUYÊN assignedPlate/lái xe -> findCarPlate
//      Conflict() (không bỏ qua DRAFT, chỉ bỏ qua REJECTED/CANCELLED) vẫn coi xe đó là "đã bận" đúng
//      khung giờ cũ, chặn oan phiếu khác (lib/workflowEngine.js).
//
// KHÁC phần lớn test trong thư mục này: KHÔNG mở trình duyệt Playwright. Cả 7 lỗ hổng nằm hoàn toàn ở
// TẦNG SERVER, nên bài này chạy thẳng express router THẬT (routes/data.js, routes/records.js) trong
// tiến trình Node + gọi thẳng lib/recordActions.js/lib/workflowEngine.js, chỉ giả lập tầng LƯU TRỮ và
// middleware xác thực — cùng khuôn tests/test-audit-fixes-batch1.js (dùng lại createRunner/assert* của
// tests/testHarness.js).
//
// Chạy: node server/tests/test-audit-round2-cluster4.js
const http = require('http');
const path = require('path');

let PORT = 0; // cổng 0 = OS tự cấp, tránh EADDRINUSE khi chạy nối tiếp cả bộ test.

// ===================== 0) Giả lập tầng lưu trữ + xác thực TRƯỚC khi require router =====================
// routes/*.js destructure các hàm DB ngay lúc require -> bản giả lập phải nằm sẵn trong require.cache.
function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

// ===================== Seed =====================
const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
// Người LẬP biên bản (minutesCreate) — đúng đối tượng mà tính năng "Mẫu Danh Sách Tham Dự" phục vụ.
const THUKY = { username: 'thuky1', name: 'Đặng Thị Ký', dept: 'Hành Chính', perms: { minutesCreate: true }, active: true };
// Người SỬA biên bản (minutesEdit, không có minutesCreate) — cũng phải quản lý được mẫu dùng chung.
const MINUTES_EDITOR = { username: 'suabb', name: 'Lê Văn Sửa', dept: 'Hành Chính', perms: { minutesEdit: true }, active: true };
// Nhân viên thường: KHÔNG có quyền nào liên quan Biên Bản Họp -> không được đụng vào mẫu dùng chung.
const PLAIN = { username: 'plain1', name: 'Nhân Viên Thường', dept: 'Kinh Doanh', perms: {}, active: true };
// Người quản lý Công Việc (taskEdit) — tạo/sửa/gán việc.
const TASKMAN = { username: 'quanlyvv', name: 'Phạm Quản Lý', dept: 'Hành Chính', perms: { taskEdit: true }, active: true };
// Người thực hiện việc (tài khoản hợp lệ, đang hoạt động).
const WORKER = { username: 'worker1', name: 'Trần Văn Thợ', dept: 'Kinh Doanh', perms: {}, active: true };
// Tài khoản ĐÃ BỊ KHOÁ — không đăng nhập được, không bao giờ được nhận việc mới.
const LOCKED = { username: 'nghiviec', name: 'Người Đã Nghỉ Việc', dept: 'Kinh Doanh', perms: {}, active: false };
// Người điều hành xe (carDispatch) + là approver bước 1 của phòng Kinh Doanh.
const DISPATCHER = { username: 'dieuhanhxe', name: 'Vũ Điều Hành', dept: 'Hành Chính', perms: { carDispatch: true }, active: true };

const USERS = [ADMIN, THUKY, MINUTES_EDITOR, PLAIN, TASKMAN, WORKER, LOCKED, DISPATCHER];

const ORIGINAL_TEMPLATES = [
  { id: 'mtpl_1', name: 'Họp giao ban tuần', attendees: [{ name: 'Nguyễn Văn A', hasAccount: 'NO' }] }
];

const APP_DATA = {
  users: USERS,
  depts: ['Kinh Doanh', 'Hành Chính', 'Ban Giám Đốc'],
  meetingAttendeeTemplates: null,
  workflows: [{ id: 'WF_1STEP', steps: [{ order: 1, name: 'Trưởng phòng duyệt' }] }],
  carDeptWorkflows: { 'Kinh Doanh': { workflowId: 'WF_1STEP', approvers: { 1: [DISPATCHER.username] } } }
};

const RECORDS = { meetingMinutes: [] };
let TASKS = [];

function resetState() {
  APP_DATA.meetingAttendeeTemplates = JSON.parse(JSON.stringify(ORIGINAL_TEMPLATES));
  RECORDS.meetingMinutes = [];
  TASKS = [];
}
resetState();

// Người dùng "đang đăng nhập" của request kế tiếp — requireAuth giả lập tra lại từ APP_DATA.users đúng
// như bản thật (không tin field nào client gửi).
let CURRENT_USERNAME = ADMIN.username;

const { HttpError } = require('../lib/httpErrors');

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAppDataValueWithVersion: async (key) => ({ value: APP_DATA[key] ?? null, version: 'v-test' }),
  getAllAppDataWithVersionsCached: async () => ({ data: { ...APP_DATA }, versions: {} }),
  getAllAppData: async () => ({ ...APP_DATA }),
  setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
  setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA[key] = value; return { conflict: false, version: 'v-test-2' }; },
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(RECORDS)),
  getAllForCollectionCached: async (c) => RECORDS[c] || [],
  getAllForCollection: async (c) => RECORDS[c] || [],
  withLockedRecordForCollection: async (c, id, mutator) => {
    const list = RECORDS[c] || [];
    const idx = list.findIndex(x => x.id === id);
    if (idx === -1) throw new HttpError(404, 'Không tìm thấy hồ sơ');
    const updated = await mutator(list[idx]);
    list[idx] = updated;
    return updated;
  },
  createForCollection: async (c, builder) => {
    const item = await builder(RECORDS[c] || []);
    (RECORDS[c] = RECORDS[c] || []).push(item);
    return item;
  },
  createForCollectionSerialized: async () => { throw new Error('không dùng trong bài test này'); },
  insertRecord: async () => { throw new Error('không dùng trong bài test này'); },
  withLockedRecordById: async () => { throw new Error('không dùng trong bài test này'); },
  deleteRecordForCollection: async () => { throw new Error('không dùng trong bài test này'); },
  withAppLock: async (key, fn) => fn()
});

stubModule('lib/taskStore', {
  getAllTasksCached: async () => TASKS,
  getAllTasks: async () => TASKS,
  insertTask: async (t) => { TASKS.push(t); return t; },
  withLockedTaskById: async (id, mutator) => {
    const idx = TASKS.findIndex(t => t.id === id);
    if (idx === -1) throw new HttpError(404, 'Không tìm thấy công việc');
    const updated = await mutator(TASKS[idx]);
    TASKS[idx] = updated;
    return updated;
  },
  deleteTaskById: async () => { throw new Error('không dùng trong bài test này'); },
  migrateDirectiveTaskLinks: async () => 0
});

stubModule('lib/auth', {
  // Bản thật re-fetch user từ DB rồi gắn req.freshUser/req.allUsers — giữ nguyên hợp đồng đó ở đây.
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next(),
  hashPassword: async (p) => `hashed:${p}`,
  isBcryptHash: (v) => String(v || '').startsWith('hashed:'),
  validatePin: () => null
});

stubModule('lib/emailCrypto', { encryptSecret: (s) => `enc:${s}` });

// ===================== 1) Require code THẬT (sau khi đã cắm bản giả lập) =====================
const express = require('express');
const { createRunner, assert, assertEqual, assertIncludes } = require('./testHarness');
const recordActions = require('../lib/recordActions');
const { applyWorkflowAction } = require('../lib/workflowEngine');
const dataRoutes = require('../routes/data');
const recordRoutes = require('../routes/records');

// ===================== 2) Client HTTP nhỏ gọn =====================
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/data', dataRoutes);
  app.use('/api/records', recordRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}

async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

// ===================== 3) Fixtures dựng sẵn =====================
// 1 biên bản họp đã lưu, có sẵn "Thành phần tham dự" + các dòng chỉ đạo — dùng cho nhóm kịch bản Fix 3.
// attendees:
//   a1 = tài khoản HỢP LỆ (worker1, đang hoạt động)
//   a2 = khai hasAccount:'YES' nhưng username KHÔNG TỒN TẠI
//   a3 = khai hasAccount:'YES' nhưng tài khoản ĐÃ BỊ KHOÁ (active:false)
//   a4 = khách mời NGOÀI công ty (hasAccount:'NO') — luồng hợp lệ, KHÔNG được vạ lây bởi bản vá
function seedMinutes(id, code, directives) {
  const record = {
    id, code, title: `Biên bản ${code}`, time: '2026-09-01T09:00', location: 'Phòng họp A',
    chair: ADMIN.name, secretary: THUKY.name, creator: THUKY.username, creatorName: THUKY.name,
    attendees: [
      { id: 'a1', name: WORKER.name, hasAccount: 'YES', username: WORKER.username, email: 'worker1@company.com' },
      { id: 'a2', name: 'Người Bịa Đặt', hasAccount: 'YES', username: 'khong_ton_tai', email: 'bia@company.com' },
      { id: 'a3', name: LOCKED.name, hasAccount: 'YES', username: LOCKED.username, email: 'nghi@company.com' },
      { id: 'a4', name: 'Khách Mời Ngoài', hasAccount: 'NO', username: '', email: 'khach@doitac.com' }
    ],
    content: 'Nội dung cuộc họp', directives, tasksAssigned: false
  };
  RECORDS.meetingMinutes.push(record);
  return record;
}

function seedTask(overrides) {
  const task = {
    id: 5000 + TASKS.length, title: 'Công việc thử nghiệm', description: '', deadline: '',
    assignedTo: WORKER.username, assignedToName: WORKER.name,
    assignedBy: TASKMAN.username, assignedByName: TASKMAN.name,
    sourceType: 'MANUAL', sourceCode: '', status: 'DOING', startedAt: '01/09/2026 08:00',
    extensionCount: 0, lateCount: 0, pendingExtension: null, pendingCancellation: null,
    collaborators: [], subtasks: [], history: [],
    ...overrides
  };
  TASKS.push(task);
  return task;
}

function seedCarReg(overrides) {
  return {
    id: 9100, code: 'XE-2026-001', dept: 'Kinh Doanh', purpose: 'Đi công tác',
    startTime: '2026-09-10T08:00', endTime: '2026-09-10T17:00',
    destination: 'Trụ sở → Chi nhánh', routePoints: ['Trụ sở', 'Chi nhánh'],
    creator: PLAIN.username, creatorName: PLAIN.name,
    status: 'PENDING', currentStep: 1, history: [],
    ...overrides
  };
}

async function main() {
  const server = await startApp();
  const run = createRunner();

  try {
    // ===================================================================================
    // Fix 1 — meetingAttendeeTemplates: gate HẸP (minutesCreate/minutesEdit), KHÔNG phải admin-only
    // ===================================================================================
    const NEW_TEMPLATES = [
      { id: 'mtpl_2', name: 'Họp Ban Giám Đốc', attendees: [{ name: 'Nguyễn Văn B', hasAccount: 'NO' }] }
    ];

    await run.run('Fix 1a — người có minutesCreate (KHÔNG phải admin) vẫn ghi được mẫu danh sách tham dự dùng chung', async () => {
      resetState();
      const res = await api('POST', '/api/data/meetingAttendeeTemplates', NEW_TEMPLATES, THUKY);
      assertEqual(res.status, 200, 'minutesCreate PHẢI ghi được — đây là tính năng chia sẻ mẫu cố ý mở cho người lập biên bản');
      assertEqual(APP_DATA.meetingAttendeeTemplates[0].id, 'mtpl_2', 'Lượt ghi của người lập biên bản phải có hiệu lực');
    });

    await run.run('Fix 1b — người có minutesEdit (không có minutesCreate) cũng ghi được', async () => {
      resetState();
      const res = await api('POST', '/api/data/meetingAttendeeTemplates', NEW_TEMPLATES, MINUTES_EDITOR);
      assertEqual(res.status, 200, 'minutesEdit cũng phải quản lý được mẫu dùng chung');
      assertEqual(APP_DATA.meetingAttendeeTemplates[0].id, 'mtpl_2', 'Lượt ghi của người sửa biên bản phải có hiệu lực');
    });

    await run.run('Fix 1c — tài khoản KHÔNG có quyền Biên Bản Họp nào bị chặn 403 và không đổi được dữ liệu', async () => {
      resetState();
      const res = await api('POST', '/api/data/meetingAttendeeTemplates', [], PLAIN);
      assertEqual(res.status, 403, 'Nhân viên thường KHÔNG được xoá/ghi đè mẫu dùng chung của cả công ty');
      assertIncludes(res.body.error, 'Biên Bản Họp', 'Thông báo lỗi phải nêu rõ cần quyền Lập/Sửa Biên Bản Họp');
      assertEqual(APP_DATA.meetingAttendeeTemplates.length, 1, 'Dữ liệu mẫu KHÔNG được thay đổi sau lượt ghi bị từ chối');
      assertEqual(APP_DATA.meetingAttendeeTemplates[0].id, 'mtpl_1', 'Mẫu cũ phải còn nguyên');
    });

    await run.run('Fix 1d — admin vẫn ghi được (gate mới không chặn nhầm Quản Trị Viên)', async () => {
      resetState();
      const res = await api('POST', '/api/data/meetingAttendeeTemplates', NEW_TEMPLATES, ADMIN);
      assertEqual(res.status, 200, 'Admin luôn phải ghi được');
      assertEqual(APP_DATA.meetingAttendeeTemplates[0].id, 'mtpl_2', 'Lượt ghi của admin phải có hiệu lực');
    });

    await run.run('Fix 1e — gate mới KHÔNG biến key này thành admin-only (khác hẳn ADMIN_ONLY_KEYS)', async () => {
      resetState();
      // Nếu ai đó "vá" bằng cách nhét meetingAttendeeTemplates vào ADMIN_ONLY_KEYS thì 1a/1b đã đỏ; kịch
      // bản này chốt thêm bằng thông báo lỗi: người bị chặn KHÔNG được nhận thông báo "chỉ Quản Trị Viên".
      const res = await api('POST', '/api/data/meetingAttendeeTemplates', [], PLAIN);
      assertEqual(res.status, 403, 'Vẫn phải chặn nhân viên thường');
      assert(!String(res.body.error).includes('Chỉ Quản Trị Viên mới có quyền sửa dữ liệu này'),
        'Đây KHÔNG phải key admin-only — thông báo lỗi phải nói về quyền Biên Bản Họp, không phải quyền Quản Trị');
    });

    // ===================================================================================
    // Fix 2 — createTask(): server ép cứng status/nguồn gốc, không tin payload client
    // ===================================================================================
    await run.run('Fix 2 — POST /api/records/tasks: payload tự soạn status:"DONE" + sourceType/sourceCode giả bị server ép về TODO/MANUAL', async () => {
      resetState();
      // 1 biên bản họp CÓ THẬT để kẻ tấn công mượn mã làm sourceCode.
      seedMinutes(3001, 'BB-2026-001', []);

      const res = await api('POST', '/api/records/tasks', {
        title: 'Việc tự nhận là đã xong',
        description: 'Nội dung',
        deadline: '2026-12-31',
        assignedTo: WORKER.username,
        // ----- 6 field TẤN CÔNG (client thật cũng gửi kèm 1 phần trong số này, nhưng luôn là giá trị mặc định) -----
        status: 'DONE',
        sourceType: 'MEETING_MINUTES',
        sourceCode: 'BB-2026-001',
        extensionCount: 5,
        pendingExtension: { newDeadline: '2027-01-01', reason: 'giả mạo', requestedBy: WORKER.username },
        pendingCancellation: { reason: 'giả mạo', requestedBy: WORKER.username }
      }, TASKMAN);

      assertEqual(res.status, 200, 'Tạo việc thủ công vẫn phải thành công (không chặn cả thao tác)');
      const item = res.body.item;
      assertEqual(item.status, 'TODO', 'Server PHẢI ép status về TODO — việc giao thủ công luôn bắt đầu ở bước chờ Nhận Việc');
      assertEqual(item.sourceType, 'MANUAL', 'Server PHẢI ép sourceType về MANUAL, không cho mạo danh nguồn Biên Bản Họp');
      assertEqual(item.sourceCode, '', 'Server PHẢI xoá sourceCode giả trỏ tới hồ sơ có thật');
      assertEqual(item.extensionCount, 0, 'Server PHẢI ép extensionCount về 0 (không cho đếm gia hạn khống)');
      assertEqual(item.pendingExtension, null, 'Server PHẢI xoá yêu cầu gia hạn treo sẵn do client gửi');
      assertEqual(item.pendingCancellation, null, 'Server PHẢI xoá yêu cầu huỷ treo sẵn do client gửi');
      assertEqual(item.assignedBy, TASKMAN.username, 'assignedBy vẫn phải lấy từ phiên đăng nhập');
      assertEqual(item.assignedToName, WORKER.name, 'assignedToName vẫn phải tra từ danh sách user thật (hành vi cũ không vỡ)');
      assertEqual(item.history.length, 1, 'history phải do server dựng lại (đúng 1 dòng CREATED)');
      assertEqual(item.history[0].action, 'CREATED', 'Dòng lịch sử đầu tiên phải là CREATED');
      assertEqual(TASKS.length, 1, 'Việc phải thực sự được lưu');
      assertEqual(TASKS[0].status, 'TODO', 'Bản ghi LƯU XUỐNG (không chỉ response) cũng phải là TODO');
    });

    // ===================================================================================
    // Fix 3 — Biên bản họp: username người tham dự phải là tài khoản đang hoạt động có thật
    // ===================================================================================
    await run.run('Fix 3a — chỉ đạo gán cho người tham dự khai username KHÔNG TỒN TẠI: không sinh Công Việc mồ côi', async () => {
      resetState();
      seedMinutes(3101, 'BB-2026-101', [
        { id: 'd1', content: 'Rà soát hợp đồng', assignedToAttendeeId: 'a2', deadline: '2026-10-01' }
      ]);

      const res = await api('POST', '/api/records/minutes/3101/assign-tasks', {}, THUKY);
      assertEqual(res.status, 400, 'Giao việc cho username bịa PHẢI bị từ chối, không được âm thầm tạo việc');
      assertIncludes(res.body.error, 'khong_ton_tai', 'Thông báo lỗi phải nêu đúng username sai để người lập biên bản sửa lại');
      assertEqual(TASKS.length, 0, 'KHÔNG được sinh Công Việc nào gán cho tài khoản không tồn tại');
      assertEqual(RECORDS.meetingMinutes[0].tasksAssigned, false, 'Biên bản KHÔNG được khoá (tasksAssigned) khi giao việc thất bại');
      assert(!RECORDS.meetingMinutes[0].directives[0].taskCreated, 'Dòng chỉ đạo không được đánh dấu đã tạo việc');
    });

    await run.run('Fix 3b — chỉ đạo gán cho tài khoản ĐÃ BỊ KHOÁ (active:false): cũng bị từ chối', async () => {
      resetState();
      seedMinutes(3102, 'BB-2026-102', [
        { id: 'd1', content: 'Bàn giao hồ sơ', assignedToAttendeeId: 'a3', deadline: '2026-10-01' }
      ]);

      const res = await api('POST', '/api/records/minutes/3102/assign-tasks', {}, THUKY);
      assertEqual(res.status, 400, 'Tài khoản đã khoá không đăng nhập được -> không được nhận việc mới');
      assertIncludes(res.body.error, LOCKED.username, 'Thông báo lỗi phải nêu đúng tài khoản đã khoá');
      assertEqual(TASKS.length, 0, 'KHÔNG được sinh Công Việc cho tài khoản đã khoá');
    });

    await run.run('Fix 3c — luồng HỢP LỆ không vỡ: tài khoản thật + khách mời ngoài công ty vẫn tạo được việc', async () => {
      resetState();
      seedMinutes(3103, 'BB-2026-103', [
        { id: 'd1', content: 'Triển khai kế hoạch quý 4', assignedToAttendeeId: 'a1', deadline: '2026-10-01' },
        { id: 'd2', content: 'Gửi báo giá cho đối tác', assignedToAttendeeId: 'a4', deadline: '2026-10-05' }
      ]);

      const res = await api('POST', '/api/records/minutes/3103/assign-tasks', {}, THUKY);
      assertEqual(res.status, 200, 'Giao việc hợp lệ phải thành công như trước');
      assertEqual(TASKS.length, 2, 'Phải tạo đủ 2 Công Việc (1 nội bộ + 1 khách mời ngoài)');

      const internal = TASKS.find(t => t.assignedTo === WORKER.username);
      assert(internal, 'Việc giao cho tài khoản hệ thống hợp lệ phải được tạo');
      assertEqual(internal.sourceType, 'MEETING_MINUTES', 'Việc từ biên bản vẫn giữ đúng nguồn MEETING_MINUTES');
      assertEqual(internal.status, 'DOING', 'Việc từ biên bản vẫn bỏ qua bước Nhận Việc (hành vi cũ không vỡ)');

      // Người tham dự KHÔNG có tài khoản (hasAccount !== 'YES') là luồng hợp lệ — bản vá không được đụng.
      const external = TASKS.find(t => !t.assignedTo);
      assert(external, 'Khách mời ngoài công ty vẫn phải được giao việc dưới dạng externalAssignee');
      assertEqual(external.externalAssignee.name, 'Khách Mời Ngoài', 'externalAssignee phải giữ nguyên tên khách mời ngoài');
      assertEqual(RECORDS.meetingMinutes[0].tasksAssigned, true, 'Biên bản phải được khoá sau khi giao việc thành công');
    });

    await run.run('Fix 3d — người PHỐI HỢP khai username bịa bị loại khỏi việc, nhưng việc chính vẫn tạo bình thường', async () => {
      resetState();
      seedMinutes(3104, 'BB-2026-104', [
        {
          id: 'd1', content: 'Chuẩn bị tài liệu', assignedToAttendeeId: 'a1', deadline: '2026-10-01',
          collaboratorAttendeeIds: ['a2', 'a4'] // a2 = username bịa, a4 = khách mời ngoài (hợp lệ)
        }
      ]);

      const res = await api('POST', '/api/records/minutes/3104/assign-tasks', {}, THUKY);
      assertEqual(res.status, 200, 'Người phối hợp sai không được làm hỏng cả việc chính');
      assertEqual(TASKS.length, 1, 'Vẫn tạo đúng 1 Công Việc');
      assertEqual(TASKS[0].collaborators.length, 0, 'Người phối hợp có username bịa PHẢI bị loại khỏi danh sách phối hợp');
      assertEqual(TASKS[0].externalCollaborators.length, 1, 'Người phối hợp ngoài công ty (hợp lệ) vẫn phải được giữ');
      assertEqual(TASKS[0].externalCollaborators[0].name, 'Khách Mời Ngoài', 'Đúng khách mời ngoài được giữ lại');
    });

    // ===================================================================================
    // Fix 4 — assignTask()/editTask(): assignedTo phải là tài khoản đang hoạt động
    // ===================================================================================
    await run.run('Fix 4a — POST /tasks/:id/assign với username KHÔNG TỒN TẠI bị từ chối, bản ghi không bị đụng', async () => {
      resetState();
      const task = seedTask({ id: 5100, assignedTo: '', assignedToName: '', status: 'TODO', sourceType: 'SUBMISSION', sourceCode: 'TT-001' });

      const res = await api('POST', '/api/records/tasks/5100/assign', { assignedTo: 'ma_khong_co_that', deadline: '2026-12-01' }, TASKMAN);
      assertEqual(res.status, 400, 'Không được gán việc cho tài khoản không tồn tại');
      assertIncludes(res.body.error, 'ma_khong_co_that', 'Thông báo lỗi phải nêu đúng username sai');
      assertEqual(task.assignedTo, '', 'Bản ghi KHÔNG được đổi khi lượt gán bị từ chối');
      assertEqual(task.status, 'TODO', 'Trạng thái cũng không được đổi sang DOING');
    });

    await run.run('Fix 4b — POST /tasks/:id/assign với tài khoản ĐÃ KHOÁ bị từ chối', async () => {
      resetState();
      seedTask({ id: 5101, assignedTo: '', assignedToName: '', status: 'TODO' });
      const res = await api('POST', '/api/records/tasks/5101/assign', { assignedTo: LOCKED.username }, TASKMAN);
      assertEqual(res.status, 400, 'Không được gán việc cho tài khoản đã bị khoá');
      assertIncludes(res.body.error, LOCKED.username, 'Thông báo lỗi phải nêu đúng tài khoản đã khoá');
    });

    await run.run('Fix 4c — assign nhiều người: 1 username sai làm hỏng CẢ lượt gán, không gán dở dang người hợp lệ', async () => {
      resetState();
      const task = seedTask({ id: 5102, assignedTo: '', assignedToName: '', status: 'TODO' });
      const res = await api('POST', '/api/records/tasks/5102/assign', { assignedTo: [WORKER.username, 'ma_bia'] }, TASKMAN);
      assertEqual(res.status, 400, 'Danh sách có 1 username sai thì cả lượt gán phải bị từ chối');
      assertEqual(task.assignedTo, '', 'Người hợp lệ đầu danh sách KHÔNG được gán dở dang vào bản ghi gốc');
      assertEqual(TASKS.length, 1, 'KHÔNG được sinh thêm bản ghi việc phụ (extraTasks) nào');
    });

    await run.run('Fix 4d — assign với tài khoản hợp lệ vẫn hoạt động như cũ (không chặn nhầm)', async () => {
      resetState();
      seedTask({ id: 5103, assignedTo: '', assignedToName: '', status: 'TODO' });
      const res = await api('POST', '/api/records/tasks/5103/assign', { assignedTo: WORKER.username, deadline: '2026-12-01' }, TASKMAN);
      assertEqual(res.status, 200, 'Gán cho tài khoản hợp lệ phải thành công');
      assertEqual(res.body.item.assignedTo, WORKER.username, 'Người nhận phải được ghi đúng');
      assertEqual(res.body.item.assignedToName, WORKER.name, 'Tên hiển thị phải tra từ danh sách user thật');
    });

    await run.run('Fix 4e — POST /tasks/:id/edit đổi người nhận sang username bịa/đã khoá bị từ chối', async () => {
      resetState();
      const task = seedTask({ id: 5104, title: 'Việc đang chạy' });

      const fake = await api('POST', '/api/records/tasks/5104/edit', { title: 'Việc đang chạy', assignedTo: 'nguoi_khong_co' }, TASKMAN);
      assertEqual(fake.status, 400, 'Sửa việc sang username bịa PHẢI bị từ chối');
      assertIncludes(fake.body.error, 'nguoi_khong_co', 'Thông báo lỗi phải nêu đúng username sai');
      assertEqual(task.assignedTo, WORKER.username, 'Người nhận cũ phải giữ nguyên');

      const locked = await api('POST', '/api/records/tasks/5104/edit', { title: 'Việc đang chạy', assignedTo: LOCKED.username }, TASKMAN);
      assertEqual(locked.status, 400, 'Sửa việc sang tài khoản đã khoá cũng phải bị từ chối');

      const ok = await api('POST', '/api/records/tasks/5104/edit', { title: 'Việc đã sửa tên', assignedTo: WORKER.username }, TASKMAN);
      assertEqual(ok.status, 200, 'Sửa việc với người nhận hợp lệ vẫn phải chạy như cũ');
      assertEqual(ok.body.item.title, 'Việc đã sửa tên', 'Nội dung sửa hợp lệ phải được lưu');
    });

    // ===================================================================================
    // Fix 5 — editTask() không được rút hạn việc chính xuống dưới hạn subtask đã có
    // ===================================================================================
    await run.run('Fix 5a — rút deadline việc chính xuống TRƯỚC dueDate của subtask đã tồn tại bị từ chối', async () => {
      resetState();
      const task = seedTask({
        id: 5200, deadline: '2026-12-31',
        subtasks: [
          { id: 1, title: 'Bước 1', dueDate: '2026-11-15', done: false },
          { id: 2, title: 'Bước 2', dueDate: '2026-12-20', done: false }
        ]
      });

      const res = await api('POST', '/api/records/tasks/5200/edit', {
        title: 'Công việc thử nghiệm', assignedTo: WORKER.username, deadline: '2026-12-01'
      }, TASKMAN);

      assertEqual(res.status, 400, 'Không được đặt hạn việc chính sớm hơn hạn của công việc nhỏ đang có');
      assertIncludes(res.body.error, 'Bước 2', 'Thông báo lỗi phải chỉ đúng công việc nhỏ đang vi phạm');
      assertEqual(task.deadline, '2026-12-31', 'Hạn cũ phải giữ nguyên khi lượt sửa bị từ chối');
    });

    await run.run('Fix 5b — rút deadline nhưng VẪN sau mọi subtask thì được chấp nhận (không chặn nhầm)', async () => {
      resetState();
      seedTask({
        id: 5201, deadline: '2026-12-31',
        subtasks: [{ id: 1, title: 'Bước 1', dueDate: '2026-11-15', done: false }]
      });

      const res = await api('POST', '/api/records/tasks/5201/edit', {
        title: 'Công việc thử nghiệm', assignedTo: WORKER.username, deadline: '2026-11-20'
      }, TASKMAN);
      assertEqual(res.status, 200, 'Hạn mới vẫn muộn hơn mọi công việc nhỏ -> phải cho qua');
      assertEqual(res.body.item.deadline, '2026-11-20', 'Hạn mới phải được lưu');
    });

    await run.run('Fix 5c — ràng buộc mới khớp đúng ràng buộc addSubtask() (cùng 1 luật, 2 thời điểm)', async () => {
      resetState();
      const task = seedTask({ id: 5202, deadline: '2026-11-20', subtasks: [], assignedTo: WORKER.username });
      // addSubtask() đã chặn hạn subtask vượt hạn việc chính từ trước — chốt lại để chắc chắn 2 chiều
      // (tạo subtask muộn hơn / rút hạn việc chính) đều bị khoá bởi CÙNG 1 luật.
      const late = await api('POST', '/api/records/tasks/5202/add-subtask', { title: 'Quá hạn', dueDate: '2026-12-01' }, WORKER);
      assertEqual(late.status, 400, 'Hành vi cũ của addSubtask() phải còn nguyên');

      const okSub = await api('POST', '/api/records/tasks/5202/add-subtask', { title: 'Hợp lệ', dueDate: '2026-11-18' }, WORKER);
      assertEqual(okSub.status, 200, 'Subtask trong hạn vẫn tạo được');
      assertEqual(task.subtasks.length, 1, 'Đúng 1 subtask được tạo');

      const shrink = await api('POST', '/api/records/tasks/5202/edit', {
        title: 'Công việc thử nghiệm', assignedTo: WORKER.username, deadline: '2026-11-17'
      }, TASKMAN);
      assertEqual(shrink.status, 400, 'Rút hạn việc chính xuống dưới subtask vừa tạo cũng phải bị chặn');
    });

    // ===================================================================================
    // Fix 6 — requestExtension(): không cho ghi đè yêu cầu gia hạn đang chờ duyệt
    // ===================================================================================
    await run.run('Fix 6a — yêu cầu gia hạn thứ HAI khi yêu cầu cũ chưa được xử lý bị chặn 409', async () => {
      resetState();
      const task = seedTask({ id: 5300, deadline: '2026-10-01', assignedTo: WORKER.username });

      const first = await api('POST', '/api/records/tasks/5300/request-extension', {
        newDeadline: '2026-10-15', reason: 'Chờ đối tác phản hồi'
      }, WORKER);
      assertEqual(first.status, 200, 'Yêu cầu gia hạn đầu tiên phải thành công như cũ');
      assertEqual(task.pendingExtension.newDeadline, '2026-10-15', 'Yêu cầu đầu tiên phải được ghi nhận');

      const second = await api('POST', '/api/records/tasks/5300/request-extension', {
        newDeadline: '2027-06-30', reason: 'Đổi ý, xin thêm 8 tháng'
      }, WORKER);
      assertEqual(second.status, 409, 'Yêu cầu thứ hai PHẢI bị chặn khi yêu cầu cũ còn chờ duyệt');
      assertIncludes(second.body.error, 'chờ duyệt', 'Thông báo lỗi phải nói rõ đang có yêu cầu chờ duyệt');
      assertEqual(task.pendingExtension.newDeadline, '2026-10-15',
        'Yêu cầu đang chờ KHÔNG được bị ghi đè — người giao việc phải duyệt đúng hạn mà họ đã đọc');
      assertEqual(task.pendingExtension.reason, 'Chờ đối tác phản hồi', 'Lý do của yêu cầu đang chờ cũng không được bị thay');
    });

    await run.run('Fix 6b — sau khi người giao việc TỪ CHỐI, người nhận xin gia hạn lại được (không khoá vĩnh viễn)', async () => {
      resetState();
      seedTask({ id: 5301, deadline: '2026-10-01', assignedTo: WORKER.username, assignedBy: TASKMAN.username });

      await api('POST', '/api/records/tasks/5301/request-extension', { newDeadline: '2026-10-15', reason: 'Lý do 1' }, WORKER);
      const rejected = await api('POST', '/api/records/tasks/5301/reject-extension', {}, TASKMAN);
      assertEqual(rejected.status, 200, 'Người giao việc từ chối được như cũ');
      assertEqual(rejected.body.item.pendingExtension, null, 'Từ chối phải dọn sạch yêu cầu đang chờ');

      const again = await api('POST', '/api/records/tasks/5301/request-extension', { newDeadline: '2026-10-10', reason: 'Lý do 2' }, WORKER);
      assertEqual(again.status, 200, 'Hết yêu cầu treo thì phải xin gia hạn lại được — bản vá không được khoá cứng');
    });

    // ===================================================================================
    // Fix 7 — carRegs REQUEST_CHANGES phải trả phiếu về trạng thái "chưa phân công"
    // ===================================================================================
    await run.run('Fix 7a — REQUEST_CHANGES xoá sạch biển số/lái xe đã gán khi đưa phiếu về NHÁP', () => {
      resetState();
      const item = seedCarReg({
        assignedPlate: '51A-12345', assignedVehicleType: 'Xe 7 chỗ',
        assignedDriverUsername: WORKER.username, assignedDriver: WORKER.name,
        driverConfirmed: true, driverConfirmedAt: '05/09/2026 10:00'
      });

      const outcome = applyWorkflowAction({
        moduleKey: 'carRegs', item, action: 'REQUEST_CHANGES', user: DISPATCHER,
        comment: 'Sai lộ trình, vui lòng sửa lại',
        appData: { carDeptWorkflows: APP_DATA.carDeptWorkflows, workflows: APP_DATA.workflows },
        existingCollection: [item], users: USERS
      });

      assertEqual(outcome.item.status, 'DRAFT', 'Hành vi cũ: phiếu về NHÁP');
      assertEqual(outcome.item.currentStep, 0, 'Hành vi cũ: quay về bước 0 để gửi lại từ đầu');
      assertEqual(outcome.item.assignedPlate, '', 'Biển số đã gán PHẢI bị xoá khi phiếu quay về NHÁP');
      assertEqual(outcome.item.assignedVehicleType, '', 'Loại xe đã gán PHẢI bị xoá');
      assertEqual(outcome.item.assignedDriverUsername, '', 'Lái xe đã gán PHẢI bị xoá');
      assertEqual(outcome.item.assignedDriver, '', 'Tên lái xe hiển thị PHẢI bị xoá');
      assertEqual(outcome.item.driverConfirmed, false, 'Xác nhận chuyến của lái xe cũ PHẢI bị huỷ');
      assertEqual(outcome.item.driverConfirmedAt, null, 'Mốc xác nhận cũ PHẢI bị xoá');
    });

    await run.run('Fix 7b — sau REQUEST_CHANGES, phiếu KHÁC dùng đúng biển số/khung giờ đó không còn bị chặn oan', () => {
      resetState();
      const draftReg = seedCarReg({
        id: 9100, code: 'XE-2026-001',
        assignedPlate: '51A-12345', assignedVehicleType: 'Xe 7 chỗ',
        assignedDriverUsername: WORKER.username, assignedDriver: WORKER.name
      });
      applyWorkflowAction({
        moduleKey: 'carRegs', item: draftReg, action: 'REQUEST_CHANGES', user: DISPATCHER,
        comment: 'Sửa lại lộ trình',
        appData: { carDeptWorkflows: APP_DATA.carDeptWorkflows, workflows: APP_DATA.workflows },
        existingCollection: [draftReg], users: USERS
      });
      // ĐỐI CHỨNG trước: cơ chế phát hiện trùng biển số (findCarPlateConflict, KHÔNG bỏ qua phiếu DRAFT
      // — chỉ bỏ qua REJECTED/CANCELLED) vẫn đang hoạt động. Dùng 1 phiếu KHÁC còn NGUYÊN biển số đã gán
      // để chắc chắn kịch bản bên dưới "không còn bị chặn" là do biển số đã được DỌN, không phải do cơ
      // chế kiểm trùng vô tình hỏng.
      const stillAssigned = seedCarReg({
        id: 9150, code: 'XE-2026-0015', status: 'APPROVED', assignedPlate: '51A-12345'
      });
      const control = seedCarReg({ id: 9250, code: 'XE-2026-0025', startTime: '2026-09-10T09:00', endTime: '2026-09-10T12:00' });
      let controlErr = null;
      try {
        applyWorkflowAction({
          moduleKey: 'carRegs', item: control, action: 'APPROVE', user: DISPATCHER, comment: 'Duyệt',
          extraFields: { assignedPlate: '51A-12345' },
          appData: { carDeptWorkflows: APP_DATA.carDeptWorkflows, workflows: APP_DATA.workflows },
          existingCollection: [stillAssigned, control], users: USERS
        });
      } catch (err) { controlErr = err; }
      assert(controlErr && controlErr.status === 409, 'ĐỐI CHỨNG: xe đang thực sự bận khung giờ đó vẫn PHẢI bị báo trùng (cơ chế kiểm trùng còn sống)');

      // Kiểm chứng qua đúng đường thật: duyệt 1 phiếu KHÁC + gán chính biển số đó, trùng khung giờ với
      // phiếu vừa bị yêu cầu chỉnh sửa. Nếu biển số không được dọn, phiếu nháp kia vẫn "giữ chỗ" chiếc xe
      // suốt thời gian nó nằm chờ người tạo sửa -> lượt duyệt này sẽ bị 409 oan.
      const second = seedCarReg({ id: 9200, code: 'XE-2026-002', startTime: '2026-09-10T09:00', endTime: '2026-09-10T12:00' });
      const outcome = applyWorkflowAction({
        moduleKey: 'carRegs', item: second, action: 'APPROVE', user: DISPATCHER, comment: 'Duyệt',
        extraFields: { assignedPlate: '51A-12345', assignedVehicleType: 'Xe 7 chỗ', assignedDriverUsername: WORKER.username },
        appData: { carDeptWorkflows: APP_DATA.carDeptWorkflows, workflows: APP_DATA.workflows },
        existingCollection: [draftReg, second], users: USERS
      });
      assertEqual(outcome.item.assignedPlate, '51A-12345', 'Phiếu mới PHẢI gán được biển số vừa được giải phóng');
      assertEqual(outcome.transition.type, 'COMPLETED', 'Quy trình 1 bước -> duyệt xong là hoàn tất');
    });

    await run.run('Fix 7c — REQUEST_CHANGES của module KHÁC (officeReqs) không bị đụng bởi bản vá riêng cho carRegs', () => {
      resetState();
      APP_DATA.officeBuyDeptWorkflows = { 'Kinh Doanh': { workflowId: 'WF_1STEP', approvers: { 1: [DISPATCHER.username] } } };
      const req = {
        id: 9300, code: 'MB-2026-001', dept: 'Kinh Doanh', subType: 'MUA_BAN', title: 'Mua bàn ghế',
        amount: 3000000, status: 'PENDING', currentStep: 1, history: [], creator: PLAIN.username
      };
      const outcome = applyWorkflowAction({
        moduleKey: 'officeReqs', item: req, action: 'REQUEST_CHANGES', user: DISPATCHER, comment: 'Sửa số lượng',
        appData: {
          officeBuyDeptWorkflows: APP_DATA.officeBuyDeptWorkflows,
          workflows: APP_DATA.workflows
        },
        existingCollection: [req], users: USERS
      });
      assertEqual(outcome.item.status, 'DRAFT', 'officeReqs vẫn về NHÁP như cũ');
      assertEqual(outcome.item.assignedPlate, undefined, 'Bản vá chỉ chạm carRegs — không được bịa field xe vào module khác');
    });
  } finally {
    server.close();
  }

  run.summary();
}

main().catch((err) => {
  console.error('Lỗi không mong đợi khi chạy test-audit-round2-cluster4.js:', err);
  process.exitCode = 1;
});
