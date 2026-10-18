#!/usr/bin/env node
'use strict';

// ==========================================================================
// Regression: email "Cần phê duyệt" (NOTIFY_APPROVAL_NEEDED) cho 4 luồng trước đây CHƯA TỪNG có bất kỳ
// email nào (đợt rà soát chuyên sâu lần 2 trước go-live, mức Trung Bình — Agent 6):
//   - Đồng Phục: kỳ cấp phát (uniformPeriods) + điều chuyển kho (uniformTransfers)
//   - Nghỉ Phép (leaveRequests)
//   - Đổi Ca (shiftSwapRequests)
//   - Đào Tạo - Huỷ Đăng Ký (trainingRegistrations, nhánh KHÔNG phải admin -> tạo pendingCancellation)
//
// Cùng kiến trúc hand-stub fetch + Playwright như tests/test-approval-hub.js (xem rationale đầy đủ ở đó)
// — KHÔNG dùng testHarness.js (validateAndPrepareCreate() thật của leaveRequests/shiftSwapRequests cần
// quá nhiều fixture phụ không liên quan tới mục tiêu test này — xác nhận hồ sơ nhân sự/mô hình chấm
// công/quỹ phép năm, đã có test riêng ở test-attendance-leave.js). Mục tiêu DUY NHẤT ở đây: xác nhận
// notifyUsersByEmail() được GỌI ĐÚNG (module/actionType/đúng danh sách người nhận) tại đúng 5 điểm tạo
// hồ sơ mới — không test lại nghiệp vụ tạo hồ sơ (đã có test riêng cho từng module).
//
// Run: node server/tests/test-approvalneeded-email-uniform-leave-swap-training.js
// ==========================================================================

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
const PORT = 8996;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath.startsWith('/js/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
          res.end(data);
        });
      }
      if (urlPath.startsWith('/fragments/')) {
        const PUBLIC_DIR = path.join(__dirname, '..', 'public');
        const filePath = path.join(PUBLIC_DIR, urlPath);
        if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
        return fs.readFile(filePath, (err, data) => {
          if (err) { res.writeHead(404); return res.end('Not found: ' + urlPath); }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        });
      }
      fs.readFile(INDEX_HTML_PATH, (err, data) => {
        if (err) { res.writeHead(500); res.end(String(err)); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  if (pass) console.log(`PASS: ${name}`);
  else console.log(`FAIL: ${name}${detail ? ' -- ' + detail : ''}`);
}

async function scenario(name, fn) {
  try {
    await fn();
  } catch (e) {
    record(name, false, 'threw: ' + (e && e.message ? e.message : String(e)));
  }
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  page.on('dialog', d => d.dismiss().catch(() => {}));

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
  await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));
  await page.waitForTimeout(150);

  // ==========================================================================
  // SETUP: stub alert/confirm/prompt/fetch; monkeypatch notifyUsersByEmail() thành spy (window.__emailCalls)
  // — ghi lại ĐÚNG đối số thật mà mọi điểm gọi truyền vào, không cần đi hết toàn bộ đường ống email thật
  // (dispatchRealEmail()/POST /api/send-email, đã có test riêng ở test-approval-needed-email-template.js).
  // ==========================================================================
  await page.evaluate(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
    window.prompt = () => 'Lý do test';
    window.__fetchHandlers = {};
    window.fetch = async (url, opts) => {
      const method = (opts && opts.method) || 'GET';
      const key = `${method} ${url}`;
      const handler = window.__fetchHandlers[key] || window.__fetchHandlers[url];
      const result = handler ? handler(opts && opts.body ? JSON.parse(opts.body) : {}) : { status: 200, body: {} };
      const status = result.status || 200;
      return { ok: status >= 200 && status < 300, status, json: async () => result.body || {} };
    };

    window.__emailCalls = [];
    window.notifyUsersByEmail = (...args) => { window.__emailCalls.push(args); };

    DB.depts = ['Kế Toán'];
    DB.stores = ['Siêu Thị A', 'Siêu Thị B'];
    DB.users = [];
    // Danh sách người nhận AN TOÀN theo từng cờ quyền (mirror computeModuleApproverUsernames() thật ở
    // server, lib/recordViewScope.js — test này seed TRỰC TIẾP vì không có GET /api/data thật chạy qua).
    DB.moduleApproverUsernames = {
      uniformApprove: ['ua1'], uniformManage: ['um1'],
      hrLeaveApprove: ['tp1', 'tp_other_store'], hrAttendanceManage: ['hr1'],
      hrShiftSwapApprove: ['gd_a', 'gd_b'], trainingManage: ['tm1']
    };
    // submitHacLeaveRequest()/submitHacSwapRequest() gọi await initDatabase(currentUser) SAU khi gửi
    // email (đúng hành vi thật, tải lại dữ liệu mới nhất) — initDatabase() gán "DB.x = data.x || <mặc
    // định>" cho MỌI field (core.js ~dòng 5119), nên PHẢI trả lại ĐÚNG state hiện tại (đọc động tại thời
    // điểm gọi, không phải snapshot cũ) cho GET /api/data, nếu không mọi state seed thủ công ở trên sẽ
    // bị XOÁ TRẮNG về {}/[] ngay sau scenario ĐẦU TIÊN có gọi initDatabase(), ảnh hưởng SAI các scenario
    // chạy SAU trong cùng file (dù chính scenario đó vẫn đúng, vì notify luôn chạy TRƯỚC initDatabase()).
    window.__fetchHandlers['GET /api/data'] = () => ({
      status: 200,
      body: {
        moduleApproverUsernames: DB.moduleApproverUsernames, users: DB.users, stores: DB.stores, depts: DB.depts,
        leaveRequests: DB.leaveRequests, shiftSwapRequests: DB.shiftSwapRequests, shiftRoster: DB.shiftRoster
      }
    });
  });

  // ==========================================================================
  // 1) Đồng Phục - Kỳ Cấp Phát: người tạo (um1, uniformManage) -> email đi đúng [ua1, um1] (cờ phẳng
  // toàn công ty, KHÔNG theo phòng ban — getFlatApproverUsernames(['uniformApprove','uniformManage'])).
  // ==========================================================================
  await scenario('Đồng Phục - Kỳ Cấp Phát: tạo kỳ mới -> notifyUsersByEmail("UNIFORM", ...) đúng người nhận', async () => {
    const r = await page.evaluate(async () => {
      const um1 = { username: 'um1', name: 'Hành Chính', dept: 'Kế Toán', role: 'NHANVIEN', jobTitle: null, perms: { admin: false, moduleAccess: {}, uniformManage: true } };
      DB.users.push(um1);
      finishLogin(um1);

      window.__fetchHandlers['POST /api/create/uniformPeriods'] = (body) => ({
        status: 200, body: { ok: true, item: { id: 1001, name: body.name, allocations: body.allocations, approvalStatus: 'PENDING_APPROVAL', createdAt: body.createdAt } }
      });

      DB.uniformPeriods = [];
      document.getElementById('uniformPeriodName').value = 'Kỳ Test Email';
      document.getElementById('uniformPeriodNote').value = '';
      uniformAllocBlocks = [];
      addUniformAllocationBlock();
      updateUniformAllocDept(0, 'Siêu Thị A');
      updateUniformAllocItemField(0, 0, 'name', 'Áo đồng phục');
      updateUniformAllocItemField(0, 0, 'size', 'L');
      updateUniformAllocItemField(0, 0, 'qty', '5');

      window.__emailCalls = [];
      await submitUniformPeriod();
      return { emailCalls: window.__emailCalls, alerts: window.__alerts.slice() };
    });
    record('gửi ĐÚNG 1 lần email "UNIFORM"/"NOTIFY_APPROVAL_NEEDED"',
      r.emailCalls.length === 1 && r.emailCalls[0][0] === 'UNIFORM' && r.emailCalls[0][1] === 'NOTIFY_APPROVAL_NEEDED', JSON.stringify(r));
    record('người nhận đúng [ua1, um1] (uniformApprove + uniformManage, cờ phẳng toàn công ty)',
      JSON.stringify([...r.emailCalls[0][3]].sort()) === JSON.stringify(['ua1', 'um1']), JSON.stringify(r.emailCalls[0]));
  });

  // ==========================================================================
  // 2) Đồng Phục - Điều Chuyển Kho: tương tự, qua route riêng /api/records/uniformTransfers/create.
  // ==========================================================================
  await scenario('Đồng Phục - Điều Chuyển Kho: gửi yêu cầu -> notifyUsersByEmail("UNIFORM", ...) đúng người nhận', async () => {
    const r = await page.evaluate(async () => {
      DB.uniformTransfers = [];
      window.__fetchHandlers['POST /api/records/uniformTransfers/create'] = (body) => ({
        status: 200, body: { ok: true, item: { id: 1002, sourceDept: currentUser.dept, targetDept: body.targetDept, itemName: body.itemName, size: body.size, qty: body.qty, requestedAt: '2026-11-01 10:00:00' } }
      });
      document.getElementById('uniformTransferTargetDept').value = 'Siêu Thị B';
      // #uniformTransferItemSize là <select> dựng option ĐỘNG từ computeUniformStockClient() (cần dữ
      // liệu tồn kho thật, không liên quan mục tiêu test này) — tự chèn thẳng 1 option khớp đúng giá trị
      // cần thay vì dựng lại toàn bộ chuỗi uniformPeriods/uniformIssuances chỉ để có tồn kho > 0.
      const itemSizeSel = document.getElementById('uniformTransferItemSize');
      itemSizeSel.innerHTML = '<option value="Áo đồng phục|||L">Áo đồng phục (L)</option>';
      itemSizeSel.value = 'Áo đồng phục|||L';
      document.getElementById('uniformTransferQty').value = '3';
      document.getElementById('uniformTransferReason').value = 'Thiếu hàng';

      window.__emailCalls = [];
      await submitUniformTransfer();
      return { emailCalls: window.__emailCalls };
    });
    record('gửi ĐÚNG 1 lần email "UNIFORM"/"NOTIFY_APPROVAL_NEEDED"',
      r.emailCalls.length === 1 && r.emailCalls[0][0] === 'UNIFORM' && r.emailCalls[0][1] === 'NOTIFY_APPROVAL_NEEDED', JSON.stringify(r));
    record('người nhận đúng [ua1, um1]',
      JSON.stringify([...r.emailCalls[0][3]].sort()) === JSON.stringify(['ua1', 'um1']), JSON.stringify(r.emailCalls[0]));
  });

  // ==========================================================================
  // 3) Nghỉ Phép: người nộp đơn (nv1) có quản lý trực tiếp "tp1" (CÓ hrLeaveApprove) -> tp1 PHẢI có mặt;
  // "tp_other_store" có cờ hrLeaveApprove nhưng KHÔNG phải quản lý của nv1 -> PHẢI bị loại trừ (resolveHacManagerChainApprovers
  // chỉ dò đúng CHUỖI QUẢN LÝ của người nộp, không phải MỌI người có cờ). hr1 (hrAttendanceManage, công ty) luôn có mặt.
  // ==========================================================================
  await scenario('Nghỉ Phép: nộp đơn -> notifyUsersByEmail("HR_LEAVE", ...) đúng quản lý trực tiếp + HR, loại trừ người có cờ nhưng không phải quản lý', async () => {
    const r = await page.evaluate(async () => {
      const tp1 = { username: 'tp1', name: 'Trưởng Phòng', dept: 'Kế Toán', role: 'NHANVIEN', jobTitle: null, perms: { admin: false, moduleAccess: {}, hrLeaveApprove: true } };
      const nv1 = { username: 'nv1', name: 'Nhân Viên Một', dept: 'Kế Toán', role: 'NHANVIEN', jobTitle: null, managerUsername: 'tp1', perms: { admin: false, moduleAccess: {} } };
      DB.users.push(tp1, nv1);
      finishLogin(nv1);

      window.__fetchHandlers['POST /api/create/leaveRequests'] = (body) => ({
        status: 200, body: { ok: true, item: { id: 2001, employeeCode: 'NV1', leaveType: body.leaveType, fromDate: body.fromDate, toDate: body.toDate, status: 'PENDING', createdAt: '2026-11-01 10:00:00' } }
      });

      document.getElementById('hacLrType').value = 'SICK';
      document.getElementById('hacLrFromDate').value = '2026-11-05';
      document.getElementById('hacLrToDate').value = '2026-11-05';
      document.getElementById('hacLrReason').value = 'Khám bệnh';

      window.__emailCalls = [];
      await submitHacLeaveRequest({ preventDefault: () => {} });
      return { emailCalls: window.__emailCalls };
    });
    record('gửi ĐÚNG 1 lần email "HR_LEAVE"/"NOTIFY_APPROVAL_NEEDED"',
      r.emailCalls.length === 1 && r.emailCalls[0][0] === 'HR_LEAVE' && r.emailCalls[0][1] === 'NOTIFY_APPROVAL_NEEDED', JSON.stringify(r));
    record('người nhận đúng [hr1, tp1] — quản lý trực tiếp CÓ cờ + HR công ty, loại trừ "tp_other_store" (có cờ nhưng không phải quản lý của nv1)',
      JSON.stringify([...r.emailCalls[0][3]].sort()) === JSON.stringify(['hr1', 'tp1']), JSON.stringify(r.emailCalls[0]));
  });

  // ==========================================================================
  // 4) Đổi Ca: người xin đổi (nv_a, Siêu Thị A) -> gd_a (hrShiftSwapApprove, CÙNG siêu thị) PHẢI có mặt;
  // gd_b (hrShiftSwapApprove nhưng Siêu Thị B KHÁC) PHẢI bị loại trừ. hr1 luôn có mặt.
  // ==========================================================================
  await scenario('Đổi Ca: gửi yêu cầu -> notifyUsersByEmail("HR_SWAP", ...) đúng người duyệt CÙNG siêu thị + HR, loại trừ siêu thị khác', async () => {
    const r = await page.evaluate(async () => {
      const nv_a = { username: 'nv_a', name: 'Nhân Viên Siêu Thị A', dept: 'Siêu Thị A', role: 'NHANVIEN', jobTitle: null, perms: { admin: false, moduleAccess: {} } };
      const gd_a = { username: 'gd_a', name: 'GD Siêu Thị A', dept: 'Siêu Thị A', role: 'NHANVIEN', jobTitle: null, perms: { admin: false, moduleAccess: {}, hrShiftSwapApprove: true } };
      const gd_b = { username: 'gd_b', name: 'GD Siêu Thị B', dept: 'Siêu Thị B', role: 'NHANVIEN', jobTitle: null, perms: { admin: false, moduleAccess: {}, hrShiftSwapApprove: true } };
      DB.users.push(nv_a, gd_a, gd_b);
      finishLogin(nv_a);
      DB.shiftRoster = [{ id: 501, employeeCode: 'NV-A', workDate: '2026-11-10', shiftTemplateId: 1, storeCode: 'Siêu Thị A', status: 'SCHEDULED' }];

      window.__fetchHandlers['POST /api/create/shiftSwapRequests'] = (body) => ({
        status: 200, body: { ok: true, item: { id: 2101, requesterRosterId: body.requesterRosterId, requesterEmployeeCode: 'NV-A', targetEmployeeCode: body.targetEmployeeCode, status: 'PENDING', createdAt: '2026-11-01 10:00:00' } }
      });

      document.getElementById('hacSwapRosterId').value = '501';
      document.getElementById('hacSwapTargetEmployeeCode').value = 'NV-B';
      document.getElementById('hacSwapReason').value = 'Bận việc gia đình';

      window.__emailCalls = [];
      await submitHacSwapRequest({ preventDefault: () => {} });
      return { emailCalls: window.__emailCalls };
    });
    record('gửi ĐÚNG 1 lần email "HR_SWAP"/"NOTIFY_APPROVAL_NEEDED"',
      r.emailCalls.length === 1 && r.emailCalls[0][0] === 'HR_SWAP' && r.emailCalls[0][1] === 'NOTIFY_APPROVAL_NEEDED', JSON.stringify(r));
    record('người nhận đúng [gd_a, hr1] — loại trừ "gd_b" (siêu thị khác)',
      JSON.stringify([...r.emailCalls[0][3]].sort()) === JSON.stringify(['gd_a', 'hr1']), JSON.stringify(r.emailCalls[0]));
  });

  // ==========================================================================
  // 5) Đào Tạo - Huỷ Đăng Ký: 2 nhánh — (a) nhân viên thường gửi yêu cầu (pendingCancellation được tạo)
  // -> PHẢI gửi email cho tm1 (trainingManage); (b) admin huỷ (có hiệu lực NGAY, pendingCancellation vẫn
  // null) -> KHÔNG được gửi email nào (không có gì "cần phê duyệt" — đã xử lý xong ngay lúc đó).
  // ==========================================================================
  await scenario('Đào Tạo - Huỷ Đăng Ký (nhân viên thường): tạo pendingCancellation -> notifyUsersByEmail("TRAINING", ...) đúng trainingManage', async () => {
    const r = await page.evaluate(async () => {
      const student = { username: 'student1', name: 'Học Viên Một', dept: 'Kế Toán', role: 'NHANVIEN', jobTitle: null, perms: { admin: false, moduleAccess: {} } };
      DB.users.push(student);
      finishLogin(student);
      DB.trainingClasses = [{ id: 601, title: 'Lớp PCCC' }];
      DB.trainingRegistrations = [{ id: 701, classId: 601, creatorName: 'Học Viên Một', result: 'REGISTERED', pendingCancellation: null }];

      window.__fetchHandlers['POST /api/records/trainingRegistrations/701/cancel'] = () => ({
        status: 200, body: { ok: true, item: { id: 701, classId: 601, creatorName: 'Học Viên Một', result: 'REGISTERED', pendingCancellation: { reason: 'Lý do test', requestedAt: '2026-11-01 10:00:00' } } }
      });

      window.__emailCalls = [];
      cancelTrainingRegistrationAction(701);
      await new Promise(r2 => setTimeout(r2, 50));
      return { emailCalls: window.__emailCalls };
    });
    record('gửi ĐÚNG 1 lần email "TRAINING"/"NOTIFY_APPROVAL_NEEDED"',
      r.emailCalls.length === 1 && r.emailCalls[0][0] === 'TRAINING' && r.emailCalls[0][1] === 'NOTIFY_APPROVAL_NEEDED', JSON.stringify(r));
    record('người nhận đúng [tm1] (trainingManage)',
      JSON.stringify([...r.emailCalls[0][3]].sort()) === JSON.stringify(['tm1']), JSON.stringify(r.emailCalls[0]));
  });

  await scenario('Đào Tạo - Huỷ Đăng Ký (admin huỷ NGAY): pendingCancellation vẫn null -> KHÔNG gửi email nào', async () => {
    const r = await page.evaluate(async () => {
      const admin1 = { username: 'admin1', name: 'Quản Trị Viên', dept: 'Kế Toán', role: 'ADMIN', jobTitle: null, perms: { admin: true, moduleAccess: {} } };
      DB.users.push(admin1);
      finishLogin(admin1);

      DB.trainingRegistrations = [{ id: 702, classId: 601, creatorName: 'Học Viên Hai', result: 'REGISTERED', pendingCancellation: null }];
      window.__fetchHandlers['POST /api/records/trainingRegistrations/702/cancel'] = () => ({
        status: 200, body: { ok: true, item: { id: 702, classId: 601, creatorName: 'Học Viên Hai', result: 'CANCELLED', pendingCancellation: null } }
      });

      window.__emailCalls = [];
      cancelTrainingRegistrationAction(702);
      await new Promise(r2 => setTimeout(r2, 50));
      return { emailCalls: window.__emailCalls };
    });
    record('admin huỷ ngay (result=CANCELLED, pendingCancellation=null) -> KHÔNG gửi email nào (không có gì chờ duyệt)',
      r.emailCalls.length === 0, JSON.stringify(r));
  });

  await browser.close();
  server.close();

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length) process.exitCode = 1;
})().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exitCode = 1;
});
