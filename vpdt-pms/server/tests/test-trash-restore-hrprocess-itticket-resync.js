// server/tests/test-trash-restore-hrprocess-itticket-resync.js
//
// LOI DA VA (re-audit lan 5, muc Trung Binh, #142 "Thung Rac khoi phuc khong dong bo lai lien ket cheo
// module"): huy/xoa QUY TRINH Nhan Su (hrProcesses, POST /hrProcesses/:id/cancel hoac /delete) tu huy
// ticket Ho Tro IT con lien ket (closeItTicketOnHrProcessClosed(), re-audit lan 3) nhung KHONG dong thoi
// go linkedTicketId tren task (co y, vi luc do quy trinh CANCELLED/bi xoa, khong ai con tac dong len
// task do nua). NHUNG neu quy trinh sau do duoc KHOI PHUC tu Thung Rac (nhanh XOA HAN), no quay lai
// DUNG trang thai truoc khi xoa (thuong van IN_PROGRESS) nhung task van giu linkedTicketId tro toi
// ticket DA CANCELLED — createItTicketForHrTask() chan cung `task.linkedTicketId != null`, task ket
// vinh vien khong tao lai duoc ticket moi.
//
// Test nay goi THANG router THAT (routes/trash.js) — chi gia lap tang luu tru (lib/recordStore) + auth,
// cung khuon tests/test-trash-sensitive-collections.js.
//
// Chay: node server/tests/test-trash-restore-hrprocess-itticket-resync.js
'use strict';
const http = require('http');
const path = require('path');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`PASS: ${name}`); }
  else { fail++; console.log(`FAIL: ${name}${detail !== undefined ? ' -- got: ' + JSON.stringify(detail) : ''}`); }
}

let TRASH, ITSUPPORTTICKETS, HRPROCESSES;
function resetData() {
  // Quy trình Onboarding IN_PROGRESS, task#1 (IT) từng có ticket #100 (nay đã CANCELLED do process bị
  // xoá trước đây), task#2 (HR) không liên kết ticket nào.
  HRPROCESSES = [];
  ITSUPPORTTICKETS = [
    { id: 100, sourceType: 'HR_PROCESS_TASK', sourceId: 999, sourceTaskId: 1, status: 'CANCELLED' },
    { id: 200, sourceType: 'HR_PROCESS_TASK', sourceId: 999, sourceTaskId: 2, status: 'TODO' }
  ];
  TRASH = [
    {
      trashId: 1, collection: 'hrProcesses', originalId: 999, code: 'HRP-999', deletedBy: 'admin1', deletedByName: 'Admin', deletedAt: '2026-01-01',
      item: {
        id: 999, processType: 'ONBOARDING', fullName: 'Ứng Viên Test', status: 'IN_PROGRESS', history: [],
        tasks: [
          { taskId: 1, taskName: 'Cấp tài khoản/máy tính', department: 'IT', status: 'PENDING', linkedTicketId: 100 },
          { taskId: 2, taskName: 'Việc khác', department: 'HR', status: 'PENDING', linkedTicketId: 200 }
        ]
      }
    },
    { trashId: 2, collection: 'docs', originalId: 50, code: 'DOC-1', deletedBy: 'admin1', deletedByName: 'Admin', deletedAt: '2026-01-01', item: { id: 50, title: 'Tài liệu thường' } }
  ];
}
resetData();

stubModule('lib/recordStore', {
  getTrashItems: async (collection) => (collection ? TRASH.filter(t => t.collection === collection) : TRASH.slice()),
  getTrashItemCollection: async (trashId) => (TRASH.find(t => t.trashId === trashId)?.collection || null),
  restoreTrashItemWithFamily: async (trashId) => {
    const idx = TRASH.findIndex(t => t.trashId === trashId);
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy'); }
    const [removed] = TRASH.splice(idx, 1);
    if (removed.collection === 'hrProcesses') HRPROCESSES.push(removed.item);
    return { collection: removed.collection, item: removed.item, restoredFamilyMembers: [], familyRestoreErrors: [] };
  },
  permanentlyDeleteTrashItem: async (trashId) => {
    const idx = TRASH.findIndex(t => t.trashId === trashId);
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy'); }
    const [removed] = TRASH.splice(idx, 1);
    return { collection: removed.collection, originalId: removed.originalId, code: removed.code || null, title: removed.item?.title || null };
  },
  getAllForCollection: async (c) => (c === 'itSupportTickets' ? ITSUPPORTTICKETS.slice() : []),
  withLockedRecordForCollection: async (c, id, mutatorFn) => {
    if (c !== 'hrProcesses') { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    const idx = HRPROCESSES.findIndex(x => x.id === Number(id));
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
    HRPROCESSES[idx] = await mutatorFn(HRPROCESSES[idx]);
    return HRPROCESSES[idx];
  }
});
stubModule('lib/approvalAuth', { consumeApprovalGrant: async () => true });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

const ADMIN_HR = { username: 'adminHr', perms: { admin: true, hrViewAll: true } };
let CURRENT_USERNAME = ADMIN_HR.username;
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = [ADMIN_HR].find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.username };
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const trashRoutes = require('../routes/trash');

async function main() {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api/trash', trashRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;
  async function api(method, urlPath, asUser) {
    CURRENT_USERNAME = asUser.username;
    const res = await fetch(`${base}${urlPath}`, { method });
    let body = null; try { body = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, body };
  }

  try {
    resetData();
    const r = await api('POST', '/api/trash/1/restore', ADMIN_HR);
    check('LỖI ĐÃ VÁ: khôi phục hrProcesses -> status 200', r.status === 200, r.body);
    const task1 = r.body?.item?.tasks?.find(t => t.taskId === 1);
    const task2 = r.body?.item?.tasks?.find(t => t.taskId === 2);
    check('LỖI ĐÃ VÁ: task có ticket đã CANCELLED -> linkedTicketId được gỡ về null (không còn kẹt, tạo lại ticket mới được)', task1 && task1.linkedTicketId === null, task1);
    check('task có ticket CÒN SỐNG (TODO) -> linkedTicketId GIỮ NGUYÊN, không bị gỡ nhầm', task2 && task2.linkedTicketId === 200, task2);
    check('history có ghi lại lượt đồng bộ tự động', (r.body?.item?.history || []).some(h => h.action === 'IT_TICKET_LINKS_RESYNCED'), r.body?.item?.history);

    resetData();
    // Ticket #100 không còn tồn tại (đã xoá vĩnh viễn luôn, không chỉ CANCELLED) — cũng phải gỡ.
    ITSUPPORTTICKETS = ITSUPPORTTICKETS.filter(t => t.id !== 100);
    const r2 = await api('POST', '/api/trash/1/restore', ADMIN_HR);
    check('ticket liên kết KHÔNG CÒN TỒN TẠI (đã xoá vĩnh viễn) -> cũng gỡ linkedTicketId, không chỉ riêng CANCELLED', r2.body?.item?.tasks?.find(t => t.taskId === 1)?.linkedTicketId === null, r2.body);

    resetData();
    // Cả 2 ticket đều CÒN SỐNG (TODO/DOING) -> không gỡ gì, không có history mới.
    ITSUPPORTTICKETS[0].status = 'DOING';
    const r3 = await api('POST', '/api/trash/1/restore', ADMIN_HR);
    const t1after = r3.body?.item?.tasks?.find(t => t.taskId === 1);
    check('cả 2 ticket liên kết đều còn sống -> KHÔNG gỡ gì (idempotent, giữ nguyên dữ liệu)', t1after?.linkedTicketId === 100, t1after);
    check('không có lượt đồng bộ nào xảy ra -> KHÔNG thêm history thừa', !(r3.body?.item?.history || []).some(h => h.action === 'IT_TICKET_LINKS_RESYNCED'), r3.body?.item?.history);

    resetData();
    // Khôi phục collection KHÁC (docs) -> không đụng gì tới cơ chế đồng bộ hrProcesses/itSupportTickets.
    const r4 = await api('POST', '/api/trash/2/restore', ADMIN_HR);
    check('khôi phục collection KHÁC (docs) -> vẫn hoạt động bình thường, không bị ảnh hưởng', r4.status === 200 && r4.body?.item?.id === 50, r4.body);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  if (fail) process.exitCode = 1;
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
