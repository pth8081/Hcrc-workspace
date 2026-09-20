// server/tests/test-minutes-task-file-ownership.js
//
// LỖI ĐÃ VÁ (rà soát chuyên sâu 2, cụm "Hành Chính", mức Thấp — phòng thủ chiều sâu): 4 route tạo-sửa
// còn thiếu assertPayloadFileUrlsOwnedByUser() cho trường "Tải tệp" (customData) — POST /minutes,
// POST /minutes/:id/edit, POST /tasks, POST /tasks/:id/edit (routes/records.js). Mirror ĐÚNG khuôn
// tests/test-edit-file-ownership.js (fake pool cho dbo.UploadedFiles, gọi thẳng router THẬT).
//
// Chạy: node server/tests/test-minutes-task-file-ownership.js
'use strict';
const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = {
    id: full, filename: full, path: path.dirname(full),
    loaded: true, exports: exportsObj, children: [], paths: []
  };
  return exportsObj;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

// ===== Fake pool cho dbo.UploadedFiles (mirror ĐÚNG test-edit-file-ownership.js) =====
const uploadedFilesStore = new Map();
const fakePool = {
  request() {
    const params = {};
    const req = {
      input(name, type, value) { params[name] = value; return req; },
      async query(text) {
        if (/INSERT INTO dbo\.UploadedFiles/.test(text)) {
          uploadedFilesStore.set(params.fileUrl, params.uploadedBy);
          return { recordset: [] };
        }
        if (/SELECT FileUrl, UploadedBy FROM dbo\.UploadedFiles/.test(text)) {
          const urls = Object.keys(params).filter(k => k.startsWith('fu')).map(k => params[k]);
          const recordset = urls.filter(u => uploadedFilesStore.has(u)).map(u => ({ FileUrl: u, UploadedBy: uploadedFilesStore.get(u) }));
          return { recordset };
        }
        throw new Error('Fake pool: câu lệnh SQL không xác định được — ' + text);
      }
    };
    return req;
  }
};
stubModule('db', {
  getPool: async () => fakePool,
  sql: { NVarChar: (n) => ({ type: 'NVarChar', n }) }
});

let MEETING_MINUTES, TASKS;
function resetRecords() {
  MEETING_MINUTES = [{
    id: 1, code: 'HCRC-HC-BBH-001', title: 'Họp giao ban tuần', time: '2026-10-20 08:00',
    location: 'Phòng họp A', chair: 'GD', secretary: 'NV1', attendees: [], content: 'Nội dung',
    directives: [], creator: 'nv1', creatorName: 'Nhân Viên 1', tasksAssigned: false,
    customData: { minutesFile: '/uploads/existing-minutes-file.pdf' }
  }];
  TASKS = [{
    id: 2, title: 'Việc cũ', description: '', assignedTo: 'nv1', assignedToName: 'Nhân Viên 1',
    assignedBy: 'nv1', assignedByName: 'Nhân Viên 1', status: 'TODO', sourceType: 'MANUAL', sourceCode: '',
    history: [], customData: { taskFile: '/uploads/existing-task-file.pdf' }
  }];
}
resetRecords();

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['meetingMinutes']),
  getAllForCollection: async (c) => (c === 'meetingMinutes' ? MEETING_MINUTES.slice() : []),
  createForCollection: async (c, builderFn) => {
    const record = await builderFn(MEETING_MINUTES);
    MEETING_MINUTES.unshift(record);
    return record;
  },
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    const idx = MEETING_MINUTES.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy hồ sơ'); }
    // Snapshot riêng (KHÔNG chia sẻ tham chiếu) — mirror ĐÚNG test-edit-file-ownership.js: nếu mutatorFn
    // throw SAU KHI đã mutate tại chỗ, bản ghi "đã lưu" không được động tới.
    const snapshot = JSON.parse(JSON.stringify(MEETING_MINUTES[idx]));
    const updated = await mutatorFn(snapshot);
    MEETING_MINUTES[idx] = updated;
    return updated;
  },
  withAppLock: async (key, fn) => fn()
});
// formTemplates: khai đúng field "Tải tệp" cho 2 module (MEETING_MINUTES/TASK) — validateRequiredCustomData()
// (lib/createValidation.js) XOÁ mọi field customData KHÔNG có tên trong danh sách này (allowedLabels),
// nên thiếu khai báo sẽ khiến customData luôn rỗng, không tài nào test được bước xác minh quyền sở hữu.
const FORM_TEMPLATES = {
  MEETING_MINUTES: [{ label: 'minutesFile', type: 'file', required: false }],
  TASK: [{ label: 'taskFile', type: 'file', required: false }]
};
stubModule('lib/appData', {
  getAllAppData: async () => ({ formTemplates: FORM_TEMPLATES }),
  getAppDataValue: async (key) => (key === 'formTemplates' ? FORM_TEMPLATES : null),
  withLockedAppDataValue: async (key, fn) => fn(null)
});
stubModule('lib/taskStore', {
  insertTask: async (t) => { TASKS.push(t); return t; },
  withLockedTaskById: async (id, mutatorFn) => {
    const idx = TASKS.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy công việc'); }
    const snapshot = JSON.parse(JSON.stringify(TASKS[idx]));
    const updated = await mutatorFn(snapshot);
    TASKS[idx] = updated;
    return updated;
  },
  deleteTaskById: async () => {}, getAllTasks: async () => TASKS.slice(), migrateDirectiveTaskLinks: async () => {}
});
stubModule('lib/operationWorkItemStore', {
  getAllWorkItems: async () => [], getWorkItemsBySource: async () => [], insertWorkItem: async () => {},
  withLockedWorkItemById: async () => {}, deleteWorkItemById: async () => {}, deleteWorkItemsByIds: async () => {}
});
stubModule('lib/employeeProfile', {});
stubModule('lib/laborContract', {});
stubModule('lib/attendance', {});
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

const NV1 = { username: 'nv1', name: 'Nhân Viên 1', dept: 'Phòng HC', perms: { minutesCreate: true, minutesEdit: true, taskEdit: true }, active: true };
const NV2 = { username: 'nv2', name: 'Nhân Viên 2', dept: 'Phòng HC', perms: {}, active: true };
const USERS = [NV1, NV2];
let CURRENT_USERNAME = NV1.username;

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const recordsRoutes = require('../routes/records');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/records', recordsRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}
async function api(method, urlPath, body, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

async function main() {
  const server = await startApp();
  try {
    // ===== POST /minutes (tạo mới) =====
    resetRecords(); uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/nv2-private-minutes.pdf', 'nv2');
    const m1 = await api('POST', '/api/records/minutes', {
      title: 'Họp mới', time: '2026-10-21 08:00', location: 'A', chair: 'GD', secretary: 'NV1',
      attendees: [], content: 'ND', customData: { minutesFile: '/uploads/nv2-private-minutes.pdf' }
    }, NV1);
    check('LỖI ĐÃ VÁ: POST /minutes chặn gắn tệp của người khác (nv2) — 403', m1.status === 403, m1.body);

    resetRecords(); uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/nv1-own-minutes.pdf', 'nv1');
    const m2 = await api('POST', '/api/records/minutes', {
      title: 'Họp mới', time: '2026-10-21 08:00', location: 'A', chair: 'GD', secretary: 'NV1',
      attendees: [], content: 'ND', customData: { minutesFile: '/uploads/nv1-own-minutes.pdf' }
    }, NV1);
    check('POST /minutes: gắn tệp CHÍNH MÌNH vừa tải lên -> thành công (200)', m2.status === 200, m2.body);

    // ===== POST /minutes/:id/edit =====
    resetRecords(); uploadedFilesStore.clear();
    const m3 = await api('POST', '/api/records/minutes/1/edit', { title: 'Đổi tiêu đề' }, NV1);
    check('POST /minutes/:id/edit: sửa field khác, giữ nguyên tệp cũ -> vẫn thành công', m3.status === 200, m3.body);

    resetRecords(); uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/nv2-private-minutes-2.pdf', 'nv2');
    const m4 = await api('POST', '/api/records/minutes/1/edit', {
      title: 'Họp giao ban tuần', customData: { minutesFile: '/uploads/nv2-private-minutes-2.pdf' }
    }, NV1);
    check('LỖI ĐÃ VÁ: POST /minutes/:id/edit chặn đổi sang tệp của người khác — 403', m4.status === 403, m4.body);
    check('Biên bản KHÔNG bị đổi customData sau khi bị chặn', MEETING_MINUTES[0].customData.minutesFile === '/uploads/existing-minutes-file.pdf', MEETING_MINUTES[0]);

    // ===== POST /tasks (tạo mới) =====
    resetRecords(); uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/nv2-private-task.pdf', 'nv2');
    const t1 = await api('POST', '/api/records/tasks', {
      title: 'Việc mới', assignedTo: 'nv1', customData: { taskFile: '/uploads/nv2-private-task.pdf' }
    }, NV1);
    check('LỖI ĐÃ VÁ: POST /tasks chặn gắn tệp của người khác (nv2) — 403', t1.status === 403, t1.body);

    resetRecords(); uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/nv1-own-task.pdf', 'nv1');
    const t2 = await api('POST', '/api/records/tasks', {
      title: 'Việc mới', assignedTo: 'nv1', customData: { taskFile: '/uploads/nv1-own-task.pdf' }
    }, NV1);
    check('POST /tasks: gắn tệp CHÍNH MÌNH vừa tải lên -> thành công (200)', t2.status === 200, t2.body);

    // ===== POST /tasks/:id/edit =====
    // LƯU Ý: editTask() (lib/recordActions.js) hiện KHÔNG copy payload.customData vào bản ghi (chỉ
    // title/description/deadline/assignedTo/collaborators — xem chú thích tại đó) — khác hẳn editMinutes()
    // (MINUTES_EDITABLE_FIELDS CÓ 'customData'). assertPayloadFileUrlsOwnedByUser() thêm ở đây vì vậy là
    // THUẦN "phòng thủ chiều sâu" cho tương lai (nếu editTask() sau này được mở thêm cho phép sửa "Tải
    // tệp") — ở hành vi HIỆN TẠI, customData gửi kèm trong payload edit luôn bị editTask() bỏ qua, nên
    // không có cách nào kích hoạt được nhánh 403 qua route này ngay lúc này. Test 2 điều CÒN THẬT:
    // (1) sửa field khác vẫn thành công; (2) dù gửi kèm customData "độc hại", bản ghi lưu lại vẫn giữ
    // NGUYÊN customData cũ (editTask() tự bỏ qua, không phải nhờ assertPayloadFileUrlsOwnedByUser()).
    resetRecords(); uploadedFilesStore.clear();
    const t3 = await api('POST', '/api/records/tasks/2/edit', { title: 'Việc cũ (đổi tên)', assignedTo: 'nv1' }, NV1);
    check('POST /tasks/:id/edit: sửa field khác, giữ nguyên tệp cũ -> vẫn thành công', t3.status === 200, t3.body);

    resetRecords(); uploadedFilesStore.clear();
    uploadedFilesStore.set('/uploads/nv2-private-task-2.pdf', 'nv2');
    const t4 = await api('POST', '/api/records/tasks/2/edit', {
      title: 'Việc cũ', assignedTo: 'nv1', customData: { taskFile: '/uploads/nv2-private-task-2.pdf' }
    }, NV1);
    check('POST /tasks/:id/edit: editTask() tự bỏ qua customData gửi kèm (chưa hỗ trợ sửa) -> vẫn 200, không lỗi', t4.status === 200, t4.body);
    check('Công việc KHÔNG bị đổi customData (editTask() không copy field này, không liên quan tới người khác)', TASKS[0].customData.taskFile === '/uploads/existing-task-file.pdf', TASKS[0]);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
