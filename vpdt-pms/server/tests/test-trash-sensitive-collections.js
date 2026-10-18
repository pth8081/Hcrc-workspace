// server/tests/test-trash-sensitive-collections.js
//
// Regression test cho LỖI NGHIÊM TRỌNG phát hiện ở đợt audit chuyên sâu 12 cụm module (9/2026):
//
//   Thùng Rác (routes/trash.js) lộ NGUYÊN VĂN payload của 5 collection cực nhạy cảm
//   (laborContracts/employeeProfiles/payslips/payrollPeriods/attendanceRecords) cho MỌI tài khoản chỉ có
//   cờ `admin`, bất kể có quyền chuyên biệt (hrContractManage/hrProfileManage/hrPayrollManage/
//   hrPayrollApprove/hrAttendanceManage) hay không — bypass hoàn toàn luật v23.28 ("admin không tự động
//   xem dữ liệu HR nhạy cảm", xem canViewLaborContract()/canViewFullProfile()/canViewAllPayroll() ở
//   lib/recordViewScope.js + lib/employeeProfile.js) ngay khi hồ sơ bị xoá.
//
// LỖI ĐÃ VÁ THÊM (re-audit lần 5, mức Trung Bình — "Admin xoá+đọc lại dữ liệu riêng tư HR qua Thùng
// Rác"): CÙNG LỚP LỖI trên nhưng bị bỏ sót ở đợt vá 9/2026, với 2 collection khác (cũng KHÔNG còn admin
// bypass trên dữ liệu SỐNG từ quyết định "mở rộng Nhân Sự" 11/2026):
//   - hrFeedback ("HCRC Đồng Hành" — RIÊNG TƯ nhất trong hệ thống, canViewHrFeedback() CHỈ cho
//     nhanSuManage hoặc chính người hỏi xem).
//   - hrProcesses (Onboarding/Offboarding — CCCD/SĐT/email/lý do nghỉ việc, canViewHrProcess() CHỈ cho
//     hrViewAll/hrOnboardingManage/hrOffboardingManage xem TOÀN BỘ).
//
// Test này gọi thẳng router THẬT (routes/trash.js) — chỉ giả lập tầng lưu trữ (lib/recordStore) + auth.
//
// Chạy: node server/tests/test-trash-sensitive-collections.js
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

// ===== Fake Thùng Rác =====
let TRASH;
function defaultTrash() {
  return [
    { trashId: 1, collection: 'laborContracts', originalId: 10, code: 'HDLD-1', deletedBy: 'admin1', deletedByName: 'Admin', deletedAt: '2026-01-01', item: { id: 10, employeeCode: 'NV001', baseSalary: 15000000 } },
    { trashId: 2, collection: 'employeeProfiles', originalId: 20, code: 'NV002', deletedBy: 'admin1', deletedByName: 'Admin', deletedAt: '2026-01-01', item: { employeeCode: 'NV002', username: null } },
    { trashId: 3, collection: 'payslips', originalId: 30, code: 'PS-1', deletedBy: 'admin1', deletedByName: 'Admin', deletedAt: '2026-01-01', item: { id: 30, netPay: 20000000 } },
    { trashId: 4, collection: 'payrollPeriods', originalId: 40, code: 'PP-1', deletedBy: 'admin1', deletedByName: 'Admin', deletedAt: '2026-01-01', item: { id: 40 } },
    { trashId: 5, collection: 'attendanceRecords', originalId: 50, code: 'AR-1', deletedBy: 'admin1', deletedByName: 'Admin', deletedAt: '2026-01-01', item: { id: 50 } },
    { trashId: 6, collection: 'docs', originalId: 60, code: 'DOC-1', deletedBy: 'admin1', deletedByName: 'Admin', deletedAt: '2026-01-01', item: { id: 60, title: 'Tài liệu thường' } },
    { trashId: 7, collection: 'hrFeedback', originalId: 70, code: 'HFB-1', deletedBy: 'admin1', deletedByName: 'Admin', deletedAt: '2026-01-01', item: { id: 70, content: 'Tâm sự riêng tư của nhân viên' } },
    { trashId: 8, collection: 'hrProcesses', originalId: 80, code: 'HRP-1', deletedBy: 'admin1', deletedByName: 'Admin', deletedAt: '2026-01-01', item: { id: 80, fullName: 'Nguyễn Văn A', nationalId: '079099001234' } }
  ];
}
function resetTrash() { TRASH = defaultTrash(); }
resetTrash();

stubModule('lib/recordStore', {
  getTrashItems: async (collection) => (collection ? TRASH.filter(t => t.collection === collection) : TRASH.slice()),
  getTrashItemCollection: async (trashId) => (TRASH.find(t => t.trashId === trashId)?.collection || null),
  restoreTrashItemWithFamily: async (trashId) => {
    const idx = TRASH.findIndex(t => t.trashId === trashId);
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy'); }
    const [removed] = TRASH.splice(idx, 1);
    return { collection: removed.collection, item: removed.item, restoredFamilyMembers: [], familyRestoreErrors: [] };
  },
  // Chữ ký trả về ĐÃ ĐỔI (đợt audit chuyên sâu 9/2026, cụm Hệ Thống/Admin/Cấu Hình): trước đây không trả
  // gì (chỉ xoá) — nay trả {collection, originalId, code, title} để routes/trash.js ghi được Nhật Ký Hệ
  // Thống có mô tả rõ ràng (xem test-audit-hethong-round2-server.js cho test riêng của phần log đó).
  permanentlyDeleteTrashItem: async (trashId) => {
    const idx = TRASH.findIndex(t => t.trashId === trashId);
    if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy'); }
    const [removed] = TRASH.splice(idx, 1);
    return { collection: removed.collection, originalId: removed.originalId, code: removed.code || null, title: removed.item?.title || null };
  }
});
stubModule('lib/approvalAuth', { consumeApprovalGrant: async () => true });
// insertSystemLog() (Nhật Ký Hệ Thống server-side, ghi khi xoá vĩnh viễn — đợt vá audit vòng 2) — stub
// tránh đụng DB thật, không thuộc phạm vi test này (đã có test riêng ở test-audit-hethong-round2-server.js).
stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });

// ADMIN_PLAIN: chỉ cờ admin, KHÔNG có quyền HR chuyên biệt nào — đúng kịch bản lỗ hổng.
const ADMIN_PLAIN = { username: 'adminPlain', perms: { admin: true } };
// ADMIN_HR: cờ admin + đủ mọi quyền HR chuyên biệt.
const ADMIN_HR = { username: 'adminHr', perms: { admin: true, hrContractManage: true, hrProfileManage: true, hrPayrollManage: true, hrAttendanceManage: true, nhanSuManage: true, hrViewAll: true } };
const USERS = [ADMIN_PLAIN, ADMIN_HR];
let CURRENT_USERNAME = ADMIN_PLAIN.username;

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.freshUser = fresh;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const trashRoutes = require('../routes/trash');

let PORT = 0;
function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/trash', trashRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(server); });
  });
}
async function api(method, urlPath, asUser) {
  if (asUser) CURRENT_USERNAME = asUser.username;
  const res = await fetch(`http://127.0.0.1:${PORT}${urlPath}`, { method });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

async function main() {
  const server = await startApp();
  try {
    // ===== GET /api/trash?collection=xxx =====
    resetTrash();
    let r = await api('GET', '/api/trash?collection=laborContracts', ADMIN_PLAIN);
    check('GET ?collection=laborContracts: admin THƯỜNG (không hrContractManage) bị chặn 403', r.status === 403, r.body);

    resetTrash();
    r = await api('GET', '/api/trash?collection=laborContracts', ADMIN_HR);
    check('GET ?collection=laborContracts: admin có hrContractManage -> 200, thấy đúng bản ghi', r.status === 200 && r.body.items.length === 1 && r.body.items[0].item.baseSalary === 15000000, r.body);

    for (const [collection, perm] of [['employeeProfiles', 'hrProfileManage'], ['payslips', 'hrPayrollManage'], ['payrollPeriods', 'hrPayrollManage']]) {
      resetTrash();
      r = await api('GET', `/api/trash?collection=${collection}`, ADMIN_PLAIN);
      check(`GET ?collection=${collection}: admin THƯỜNG (không ${perm}) bị chặn 403`, r.status === 403, r.body);
      resetTrash();
      r = await api('GET', `/api/trash?collection=${collection}`, ADMIN_HR);
      check(`GET ?collection=${collection}: admin có ${perm} -> 200`, r.status === 200 && r.body.items.length === 1, r.body);
    }

    // LỖI ĐÃ VÁ (re-audit lần 5): hrFeedback/hrProcesses — cùng khuôn 4 collection ở trên.
    for (const [collection, perm] of [['hrFeedback', 'nhanSuManage'], ['hrProcesses', 'hrViewAll']]) {
      resetTrash();
      r = await api('GET', `/api/trash?collection=${collection}`, ADMIN_PLAIN);
      check(`GET ?collection=${collection}: admin THƯỜNG (không ${perm}) bị chặn 403`, r.status === 403, r.body);
      resetTrash();
      r = await api('GET', `/api/trash?collection=${collection}`, ADMIN_HR);
      check(`GET ?collection=${collection}: admin có ${perm} -> 200`, r.status === 200 && r.body.items.length === 1, r.body);
    }

    // attendanceRecords: giữ NGUYÊN admin bypass (đúng luật riêng của attendance).
    resetTrash();
    r = await api('GET', '/api/trash?collection=attendanceRecords', ADMIN_PLAIN);
    check('GET ?collection=attendanceRecords: admin THƯỜNG vẫn xem được (đúng luật admin bypass riêng của attendance)', r.status === 200 && r.body.items.length === 1, r.body);

    // Collection KHÔNG nhạy cảm: hành vi cũ (chỉ cần admin) không bị đổi.
    resetTrash();
    r = await api('GET', '/api/trash?collection=docs', ADMIN_PLAIN);
    check('GET ?collection=docs: admin THƯỜNG vẫn xem được (collection không nhạy cảm, không bị siết thêm)', r.status === 200 && r.body.items.length === 1, r.body);

    // ===== GET /api/trash (liệt kê MỌI collection) — LỖI ĐÃ VÁ: phải TỰ LỌC BỚT collection nhạy cảm =====
    resetTrash();
    r = await api('GET', '/api/trash', ADMIN_PLAIN);
    const collectionsSeen = (r.body.items || []).map(it => it.collection).sort();
    check('GET / (mọi collection): admin THƯỜNG KHÔNG thấy laborContracts/employeeProfiles/payslips/payrollPeriods, VẪN thấy attendanceRecords/docs',
      r.status === 200 && JSON.stringify(collectionsSeen) === JSON.stringify(['attendanceRecords', 'docs']), collectionsSeen);

    resetTrash();
    r = await api('GET', '/api/trash', ADMIN_HR);
    check('GET / (mọi collection): admin đủ quyền HR thấy TẤT CẢ 8 mục', r.status === 200 && r.body.items.length === 8, r.body);

    // ===== LỖI ĐÃ VÁ (re-audit lần 5): restore/delete vĩnh viễn hrFeedback/hrProcesses =====
    resetTrash();
    r = await api('POST', '/api/trash/7/restore', ADMIN_PLAIN);
    check('restore hrFeedback: admin THƯỜNG (không nhanSuManage) bị chặn 403', r.status === 403, r.body);
    check('restore hrFeedback: KHÔNG bị xoá khỏi Thùng Rác sau khi chặn', TRASH.some(t => t.trashId === 7), TRASH);

    resetTrash();
    r = await api('POST', '/api/trash/7/restore', ADMIN_HR);
    check('restore hrFeedback: admin có nhanSuManage -> 200', r.status === 200, r.body);

    resetTrash();
    r = await api('DELETE', '/api/trash/8', ADMIN_PLAIN);
    check('delete hrProcesses: admin THƯỜNG (không hrViewAll) bị chặn 403', r.status === 403, r.body);
    check('delete hrProcesses: KHÔNG bị xoá vĩnh viễn sau khi chặn', TRASH.some(t => t.trashId === 8), TRASH);

    resetTrash();
    r = await api('DELETE', '/api/trash/8', ADMIN_HR);
    check('delete hrProcesses: admin có hrViewAll -> 200', r.status === 200, r.body);
    check('delete hrProcesses: đã xoá vĩnh viễn', !TRASH.some(t => t.trashId === 8), TRASH);

    // ===== POST /api/trash/:id/restore =====
    resetTrash();
    r = await api('POST', '/api/trash/1/restore', ADMIN_PLAIN);
    check('restore laborContracts: admin THƯỜNG bị chặn 403', r.status === 403, r.body);
    check('restore laborContracts: KHÔNG bị xoá khỏi Thùng Rác sau khi chặn (chưa restore)', TRASH.some(t => t.trashId === 1), TRASH);

    resetTrash();
    r = await api('POST', '/api/trash/1/restore', ADMIN_HR);
    check('restore laborContracts: admin có hrContractManage -> 200', r.status === 200, r.body);
    check('restore laborContracts: đã rời khỏi Thùng Rác', !TRASH.some(t => t.trashId === 1), TRASH);

    resetTrash();
    r = await api('POST', '/api/trash/6/restore', ADMIN_PLAIN);
    check('restore docs (không nhạy cảm): admin THƯỜNG vẫn restore được như cũ', r.status === 200, r.body);

    // ===== DELETE /api/trash/:id (xoá vĩnh viễn) =====
    resetTrash();
    r = await api('DELETE', '/api/trash/3', ADMIN_PLAIN);
    check('delete payslips: admin THƯỜNG bị chặn 403', r.status === 403, r.body);
    check('delete payslips: KHÔNG bị xoá vĩnh viễn sau khi chặn', TRASH.some(t => t.trashId === 3), TRASH);

    resetTrash();
    r = await api('DELETE', '/api/trash/3', ADMIN_HR);
    check('delete payslips: admin có hrPayrollManage -> 200', r.status === 200, r.body);
    check('delete payslips: đã xoá vĩnh viễn', !TRASH.some(t => t.trashId === 3), TRASH);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
