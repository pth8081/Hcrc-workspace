// server/tests/test-security-audit-round3.js
//
// Regression test cho ĐỢT RÀ SOÁT BẢO MẬT CHUYÊN SÂU LẦN 2 (6 agent song song, 11/2026) — mỗi kịch bản
// gắn với ĐÚNG 1 lỗ hổng đã vá, viết sao cho hoàn tác bản vá tương ứng là FAIL ngay:
//
//   1. [Nghiêm Trọng] CREATE_MODULE_CONFIGS.hrProcesses.extraValidate() (lib/createValidation.js) còn
//      SÓT nhánh admin bypass riêng từ đợt bỏ admin bypass nhóm Nhân Sự trước đó — canCreateHrProcess()
//      (lib/recordActions.js) đã được vá đúng (không admin bypass) nhưng luồng tạo tay đơn lẻ
//      POST /api/create/hrProcesses không gọi lại hàm đó, tự kiểm tra riêng để lộ nhánh admin bypass.
//   2. [Cao] routes/data.js — 2 key hrProfileManagerVisibleFields/hrProfileSelfVisibleFields hoàn toàn
//      KHÔNG có trong ADMIN_ONLY_KEYS lẫn NON_ADMIN_GATED_KEYS -> bất kỳ tài khoản đã đăng nhập tự mở
//      khoá xem field nhạy cảm (CCCD/tài khoản ngân hàng/lương...) của hồ sơ người khác.
//   3. [Trung Bình] uniformTransfers — approve/reject/cancel KHÔNG chặn tự quyết định yêu cầu điều
//      chuyển do CHÍNH MÌNH tạo (1 tài khoản được gán cả uniformStoreManage + uniformApprove/uniformManage).
//   4. [Trung Bình] itPriceApprovals — approve/deny "từ chối khẩn cấp" KHÔNG chặn tự quyết định yêu cầu
//      do CHÍNH MÌNH gửi (1 người duyệt bước cuối được gán thêm quyền phê duyệt từ chối khẩn cấp).
//   5-8. [Trung Bình, UI/UX] module-hopdong.js (dòng 282, 379) + module-thanhtoan.js (dòng 58, 515) —
//      `it.dueDate` render thẳng vào `value="..."` KHÔNG qua escapeHtml() như các field khác cùng dòng.
//
// 4 kịch bản đầu gọi THẲNG hàm lib/recordActions.js / lib/createValidation.js (pure function, không cần
// Playwright/HTTP) — cùng khuôn mọi test "đơn vị" khác trong thư mục này. Kịch bản 5-8 chỉ kiểm tra MÃ
// NGUỒN tĩnh (grep đúng khuôn escapeHtml()) vì đây là bug hiển thị HTML thuần, không có logic server để
// gọi.
//
// Chạy: node server/tests/test-security-audit-round3.js
const fs = require('fs');
const path = require('path');
const { createRunner, assert, assertEqual, assertIncludes } = require('./testHarness');

const recordActions = require('../lib/recordActions');
const { CREATE_MODULE_CONFIGS, CreateError } = require('../lib/createValidation');

async function main() {
  const run = createRunner();

  // ===================================================================================
  // Fix #1 (Nghiêm Trọng) — hrProcesses.extraValidate() không còn admin bypass riêng
  // ===================================================================================
  const ADMIN_NO_HR_PERM = { username: 'admin1', name: 'Quản Trị Viên', perms: { admin: true } };
  const HR_ONBOARD = { username: 'hr1', name: 'Nhân Sự Onboarding', perms: { hrOnboardingManage: true } };
  const PLAIN_NO_PERM = { username: 'plain1', name: 'Nhân Viên Thường', perms: {} };

  function callExtraValidate(user, processType) {
    const payload = { processType };
    return CREATE_MODULE_CONFIGS.hrProcesses.extraValidate(payload, [], user, {});
  }

  await run.run('LỖI ĐÃ VÁ (Nghiêm Trọng) — admin KHÔNG có hrOnboardingManage KHÔNG tự tạo tay quy trình Onboarding được nữa', async () => {
    let err = null;
    try { callExtraValidate(ADMIN_NO_HR_PERM, 'ONBOARDING'); } catch (e) { err = e; }
    assert(err instanceof CreateError, 'Phải bị chặn bằng CreateError (admin bypass đã bị gỡ khỏi extraValidate)');
    assertEqual(err.status, 403, 'Phải trả 403 Forbidden');
    assertIncludes(err.message, 'quyền', 'Thông báo lỗi phải nói rõ thiếu quyền');
  });

  await run.run('Người có hrOnboardingManage vẫn tạo tay quy trình Onboarding được (không phá tính năng)', async () => {
    let err = null;
    try { callExtraValidate(HR_ONBOARD, 'ONBOARDING'); } catch (e) { err = e; }
    // Có thể vẫn lỗi 400 ở bước validate field tiếp theo (employeeCode thiếu) — chỉ cần KHÔNG phải lỗi
    // 403 thiếu quyền là đủ xác nhận cổng quyền đã mở đúng cho người có hrOnboardingManage.
    assert(!(err instanceof CreateError && err.status === 403), 'Không được chặn người có đúng quyền hrOnboardingManage');
  });

  await run.run('Người KHÔNG có quyền gì (không admin, không hrOnboardingManage) vẫn bị chặn', async () => {
    let err = null;
    try { callExtraValidate(PLAIN_NO_PERM, 'ONBOARDING'); } catch (e) { err = e; }
    assert(err instanceof CreateError, 'Phải bị chặn');
    assertEqual(err.status, 403, 'Phải trả 403 Forbidden');
  });

  // ===================================================================================
  // Fix #2 (Cao) — routes/data.js gate hrProfileManagerVisibleFields/hrProfileSelfVisibleFields
  // ===================================================================================
  await run.run('routes/data.js — NON_ADMIN_GATED_KEYS đã có 2 key hrProfile*VisibleFields, gate đúng hrProfileManage', async () => {
    // require trực tiếp module (không qua HTTP) để kiểm tra đúng cấu trúc Map export ẩn — dùng lại
    // chính cơ chế gate thật bằng cách đọc source rồi đối chiếu, vì NON_ADMIN_GATED_KEYS không export
    // (private theo thiết kế routes/data.js, chỉ dùng nội bộ router.post). Kiểm tra qua nội dung file
    // là cách duy nhất không phải bật cả router thật (được làm đầy đủ ở integration test dưới).
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'data.js'), 'utf8');
    assertIncludes(src, "'hrProfileManagerVisibleFields'", 'Phải thêm key hrProfileManagerVisibleFields vào gate');
    assertIncludes(src, "'hrProfileSelfVisibleFields'", 'Phải thêm key hrProfileSelfVisibleFields vào gate');
    assertIncludes(src, 'sanitizeManagerVisibleFields(value)', 'Phải lọc giá trị ghi qua sanitizeManagerVisibleFields()');
    assertIncludes(src, 'sanitizeSelfVisibleFields(value)', 'Phải lọc giá trị ghi qua sanitizeSelfVisibleFields()');
  });

  await run.run('routes/data.js — integration thật qua HTTP: nhân viên thường bị 403, hrProfileManage ghi được + giá trị bị lọc đúng SENSITIVE_FIELDS', async () => {
    await testDataRouteIntegration();
  });

  // ===================================================================================
  // Fix #3 (Trung Bình) — uniformTransfers: chặn tự duyệt/tự từ chối/tự hủy
  // ===================================================================================
  const STORE_MANAGER_SELF = { username: 'gd_hoian', name: 'GĐ Hội An', dept: 'Siêu Thị Hội An', perms: { uniformStoreManage: true, uniformApprove: true } };
  const OTHER_APPROVER = { username: 'hc1', name: 'Hành Chính', dept: 'Hành Chính', perms: { uniformApprove: true } };

  function makeTransfer(overrides) {
    return Object.assign({
      id: 1, sourceDept: 'Siêu Thị Hội An', targetDept: 'Siêu Thị Đà Nẵng',
      itemName: 'Áo đồng phục nam', size: 'M', qty: 5, reason: 'Thiếu hàng',
      status: 'PENDING_APPROVAL', requestedBy: STORE_MANAGER_SELF.username, requestedByName: STORE_MANAGER_SELF.name,
      approvedBy: null, approvedByName: null, approvedAt: null, rejectReason: ''
    }, overrides);
  }

  await run.run('LỖI ĐÃ VÁ — GĐ Siêu Thị (uniformStoreManage + uniformApprove) KHÔNG tự DUYỆT được yêu cầu điều chuyển do chính mình tạo', async () => {
    const transfer = makeTransfer({});
    let err = null;
    try { recordActions.approveUniformTransfer(STORE_MANAGER_SELF, transfer, new Map()); } catch (e) { err = e; }
    assert(err, 'Phải bị chặn');
    assertEqual(err.status, 403, 'Phải trả 403');
    assertIncludes(err.message, 'tự duyệt', 'Thông báo lỗi phải nói rõ không được tự duyệt');
    assertEqual(transfer.status, 'PENDING_APPROVAL', 'Trạng thái KHÔNG được đổi khi bị chặn');
  });

  await run.run('LỖI ĐÃ VÁ — KHÔNG tự TỪ CHỐI được yêu cầu điều chuyển do chính mình tạo', async () => {
    const transfer = makeTransfer({});
    let err = null;
    try { recordActions.rejectUniformTransfer(STORE_MANAGER_SELF, transfer, { reason: 'Đổi ý' }); } catch (e) { err = e; }
    assert(err, 'Phải bị chặn');
    assertEqual(err.status, 403, 'Phải trả 403');
    assertEqual(transfer.status, 'PENDING_APPROVAL', 'Trạng thái KHÔNG được đổi khi bị chặn');
  });

  await run.run('LỖI ĐÃ VÁ — KHÔNG tự HỦY được yêu cầu điều chuyển (đã APPROVED) do chính mình tạo', async () => {
    const transfer = makeTransfer({ status: 'APPROVED', approvedBy: OTHER_APPROVER.username, approvedByName: OTHER_APPROVER.name });
    let err = null;
    try { recordActions.cancelUniformTransfer(STORE_MANAGER_SELF, transfer, { reason: 'Đổi ý' }); } catch (e) { err = e; }
    assert(err, 'Phải bị chặn');
    assertEqual(err.status, 403, 'Phải trả 403');
    assertEqual(transfer.status, 'APPROVED', 'Trạng thái KHÔNG được đổi khi bị chặn');
  });

  await run.run('Người KHÁC (không phải người tạo) vẫn duyệt/từ chối/hủy được bình thường — không phá happy path', async () => {
    const t1 = makeTransfer({});
    const row = new Map([['Áo đồng phục nam|||M', { stock: 10 }]]);
    recordActions.approveUniformTransfer(OTHER_APPROVER, t1, row);
    assertEqual(t1.status, 'APPROVED', 'Người khác (không tự tạo) phải duyệt được');

    const t2 = makeTransfer({});
    recordActions.rejectUniformTransfer(OTHER_APPROVER, t2, { reason: 'Không đủ căn cứ' });
    assertEqual(t2.status, 'REJECTED', 'Người khác (không tự tạo) phải từ chối được');

    const t3 = makeTransfer({ status: 'APPROVED' });
    recordActions.cancelUniformTransfer(OTHER_APPROVER, t3, { reason: 'Sai thông tin' });
    assertEqual(t3.status, 'CANCELLED', 'Người khác (không tự tạo) phải hủy được');
  });

  // ĐỔI QUYẾT ĐỊNH (11/2026, theo yêu cầu TRỰC TIẾP của người dùng — "Chặn admin tự duyệt ở TẤT CẢ
  // module", không có ngoại lệ): trước đây admin được bỏ qua chặn này, nay KHÔNG còn nữa.
  await run.run('Admin KHÔNG còn tự duyệt/từ chối được (đã chặn CẢ admin, theo quyết định MỚI 11/2026)', async () => {
    const ADMIN = { username: 'admin1', name: 'Admin', perms: { admin: true } };
    const t = makeTransfer({ requestedBy: ADMIN.username, requestedByName: ADMIN.name });
    const row = new Map([['Áo đồng phục nam|||M', { stock: 10 }]]);
    let err = null;
    try { recordActions.approveUniformTransfer(ADMIN, t, row); } catch (e) { err = e; }
    assert(err, 'Admin tự duyệt phải bị chặn');
    assertEqual(err.status, 403, 'Phải trả 403');
    assertEqual(t.status, 'PENDING_APPROVAL', 'Trạng thái KHÔNG được đổi khi bị chặn');
  });

  // ===================================================================================
  // Fix #4 (Trung Bình) — itPriceApprovals: chặn tự duyệt/tự từ chối "từ chối khẩn cấp"
  // ===================================================================================
  const FINAL_APPROVER_SELF = { username: 'approver_final', name: 'Người Duyệt Cuối', perms: { itPriceEmergencyRejectApproveRetail: true } };
  const OTHER_EMERGENCY_APPROVER = { username: 'khac1', name: 'Người Khác', perms: { itPriceEmergencyRejectApproveRetail: true } };

  function makeEmergencyRejectItem(overrides) {
    return Object.assign({
      id: 1, priceType: 'RETAIL', currentStep: 2, status: 'APPROVED', applied: false,
      emergencyRejectStatus: 'PENDING', emergencyRejectReason: 'Giá sai',
      emergencyRejectRequestedBy: FINAL_APPROVER_SELF.username, emergencyRejectRequestedByName: FINAL_APPROVER_SELF.name,
      history: []
    }, overrides);
  }

  await run.run('LỖI ĐÃ VÁ — người duyệt bước cuối (được gán thêm quyền phê duyệt từ chối khẩn cấp) KHÔNG tự PHÊ DUYỆT được yêu cầu do chính mình gửi', async () => {
    const item = makeEmergencyRejectItem({});
    let err = null;
    try { recordActions.approveItPriceEmergencyReject(FINAL_APPROVER_SELF, item); } catch (e) { err = e; }
    assert(err, 'Phải bị chặn');
    assertEqual(err.status, 403, 'Phải trả 403');
    assertIncludes(err.message, 'tự phê duyệt', 'Thông báo lỗi phải nói rõ không được tự phê duyệt');
    assertEqual(item.emergencyRejectStatus, 'PENDING', 'Trạng thái KHÔNG được đổi khi bị chặn');
  });

  await run.run('LỖI ĐÃ VÁ — KHÔNG tự TỪ CHỐI được yêu cầu "từ chối khẩn cấp" do chính mình gửi', async () => {
    const item = makeEmergencyRejectItem({});
    let err = null;
    try { recordActions.denyItPriceEmergencyReject(FINAL_APPROVER_SELF, item, { comment: 'Đổi ý' }); } catch (e) { err = e; }
    assert(err, 'Phải bị chặn');
    assertEqual(err.status, 403, 'Phải trả 403');
    assertEqual(item.emergencyRejectStatus, 'PENDING', 'Trạng thái KHÔNG được đổi khi bị chặn');
  });

  await run.run('Người KHÁC vẫn phê duyệt/từ chối được yêu cầu "từ chối khẩn cấp" bình thường — không phá happy path', async () => {
    const i1 = makeEmergencyRejectItem({});
    recordActions.approveItPriceEmergencyReject(OTHER_EMERGENCY_APPROVER, i1);
    assertEqual(i1.emergencyRejectStatus, 'APPROVED', 'Người khác (không tự gửi) phải phê duyệt được');
    assertEqual(i1.status, 'REJECTED', 'Hồ sơ phải chuyển REJECTED khi phê duyệt từ chối khẩn cấp');

    const i2 = makeEmergencyRejectItem({});
    recordActions.denyItPriceEmergencyReject(OTHER_EMERGENCY_APPROVER, i2, { comment: 'Không đủ căn cứ' });
    assertEqual(i2.emergencyRejectStatus, 'DENIED', 'Người khác (không tự gửi) phải từ chối được');
  });

  // ĐỔI QUYẾT ĐỊNH (11/2026, theo yêu cầu TRỰC TIẾP của người dùng — "Chặn admin tự duyệt ở TẤT CẢ
  // module", không có ngoại lệ): trước đây admin được bỏ qua chặn này, nay KHÔNG còn nữa.
  await run.run('Admin KHÔNG còn tự phê duyệt được (đã chặn CẢ admin, theo quyết định MỚI 11/2026)', async () => {
    const ADMIN = { username: 'admin1', name: 'Admin', perms: { admin: true } };
    const item = makeEmergencyRejectItem({ emergencyRejectRequestedBy: ADMIN.username, emergencyRejectRequestedByName: ADMIN.name });
    let err = null;
    try { recordActions.approveItPriceEmergencyReject(ADMIN, item); } catch (e) { err = e; }
    assert(err, 'Admin tự phê duyệt phải bị chặn');
    assertEqual(err.status, 403, 'Phải trả 403');
    assertEqual(item.emergencyRejectStatus, 'PENDING', 'Trạng thái KHÔNG được đổi khi bị chặn');
  });

  // ===================================================================================
  // Fix #5-8 (Trung Bình, UI/UX) — escapeHtml(it.dueDate) ở 4 vị trí
  // ===================================================================================
  function readSrc(relPath) {
    return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
  }

  await run.run('LỖI ĐÃ VÁ — module-hopdong.js: 2 dòng render it.dueDate đã escapeHtml()', async () => {
    const src = readSrc('public/js/module-hopdong.js');
    const bare = src.match(/value="\$\{it\.dueDate \|\| ''\}"/g) || [];
    assertEqual(bare.length, 0, 'Không còn dòng nào render it.dueDate KHÔNG qua escapeHtml()');
    const escaped = src.match(/value="\$\{escapeHtml\(it\.dueDate \|\| ''\)\}"/g) || [];
    assertEqual(escaped.length, 2, 'Phải có đúng 2 dòng (contract-installment-due + cptc-due) đã escapeHtml()');
  });

  await run.run('LỖI ĐÃ VÁ — module-thanhtoan.js: 2 dòng render it.dueDate đã escapeHtml()', async () => {
    const src = readSrc('public/js/module-thanhtoan.js');
    const bare = src.match(/value="\$\{it\.dueDate \|\| ''\}"/g) || [];
    assertEqual(bare.length, 0, 'Không còn dòng nào render it.dueDate KHÔNG qua escapeHtml()');
    const escaped = src.match(/value="\$\{escapeHtml\(it\.dueDate \|\| ''\)\}"/g) || [];
    assertEqual(escaped.length, 2, 'Phải có đúng 2 dòng (payment-installment-due x2) đã escapeHtml()');
  });

  run.summary();
}

// ===================================================================================
// Integration test Fix #2 qua HTTP thật (express router THẬT routes/data.js, giả lập tầng lưu trữ +
// xác thực) — cùng khuôn tests/test-audit-round2-cluster4.js.
// ===================================================================================
async function testDataRouteIntegration() {
  function stubModule(relPath, exportsObj) {
    const full = require.resolve(path.join(__dirname, '..', relPath));
    require.cache[full] = {
      id: full, filename: full, path: path.dirname(full),
      loaded: true, exports: exportsObj, children: [], paths: []
    };
    return exportsObj;
  }

  const ADMIN = { username: 'admin1', name: 'Admin', perms: { admin: true }, active: true };
  const HR_PROFILE_MANAGER = { username: 'hrpm1', name: 'Quản Lý Hồ Sơ NS', perms: { hrProfileManage: true }, active: true };
  const PLAIN = { username: 'plain1', name: 'Nhân Viên Thường', perms: {}, active: true };
  const USERS = [ADMIN, HR_PROFILE_MANAGER, PLAIN];
  const APP_DATA = { users: USERS, hrProfileManagerVisibleFields: [], hrProfileSelfVisibleFields: [] };
  let CURRENT_USERNAME = ADMIN.username;

  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
    getAppDataValueWithVersion: async (key) => ({ value: APP_DATA[key] ?? null, version: 'v-test' }),
    getAllAppDataWithVersionsCached: async () => ({ data: { ...APP_DATA }, versions: {} }),
    getAllAppData: async () => ({ ...APP_DATA }),
    setAppDataValue: async (key, value) => { APP_DATA[key] = value; },
    setAppDataValueIfVersionMatches: async (key, value) => { APP_DATA[key] = value; return { conflict: false, version: 'v-test-2' }; },
    withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
  });
  stubModule('lib/auth', {
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

  const express = require('express');
  const http = require('http');
  const dataRoutes = require('../routes/data');

  const app = express();
  app.use(express.json());
  app.use('/api/data', dataRoutes);
  let PORT = 0;
  const server = await new Promise((resolve, reject) => {
    const s = http.createServer(app);
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { PORT = s.address().port; resolve(s); });
  });

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

  try {
    const res1 = await api('POST', '/api/data/hrProfileManagerVisibleFields', ['bankAccountNo'], PLAIN);
    assertEqual(res1.status, 403, 'Nhân viên thường KHÔNG được sửa cấu hình field quản lý trực tiếp được xem');
    assertEqual(JSON.stringify(APP_DATA.hrProfileManagerVisibleFields), '[]', 'Giá trị KHÔNG được đổi khi bị chặn');

    const res2 = await api('POST', '/api/data/hrProfileSelfVisibleFields', ['bankAccountNo'], PLAIN);
    assertEqual(res2.status, 403, 'Nhân viên thường KHÔNG được sửa cấu hình field chính chủ được xem');

    const res3 = await api('POST', '/api/data/hrProfileManagerVisibleFields', ['bankAccountNo', 'nationalId', 'khongHopLe'], HR_PROFILE_MANAGER);
    assertEqual(res3.status, 200, 'hrProfileManage PHẢI ghi được — đây là tính năng hợp lệ của module này');
    assertEqual(JSON.stringify(APP_DATA.hrProfileManagerVisibleFields.slice().sort()), JSON.stringify(['bankAccountNo', 'nationalId'].sort()),
      'sanitizeManagerVisibleFields() phải tự loại field KHÔNG thuộc SENSITIVE_FIELDS (khongHopLe)');

    const res4 = await api('POST', '/api/data/hrProfileSelfVisibleFields', ['dateOfBirth'], HR_PROFILE_MANAGER);
    assertEqual(res4.status, 200, 'hrProfileManage PHẢI ghi được cấu hình chính chủ');
    assertEqual(JSON.stringify(APP_DATA.hrProfileSelfVisibleFields), JSON.stringify(['dateOfBirth']), 'Giá trị hợp lệ phải được lưu đúng');
  } finally {
    server.close();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
