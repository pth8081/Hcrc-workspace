// server/tests/test-hr-profile-contract-full-edit-perm.js
//
// Quyền MỚI "hrProfileContractFullEdit" (12/2026, theo yêu cầu người dùng: "1 quyền đặc biệt, sửa được
// tất cả các trường trong hồ sơ và trong hợp đồng lao động, trừ sửa mã"). Thiết kế: quyền GỘP, bật lên
// tương đương có ĐỦ CẢ hrProfileEdit LẪN hrContractManage — expand ĐÚNG 1 CHỖ (expandHrFullEditPerms(),
// lib/auth.js), áp dụng trong requireAuth() (mọi route server) VÀ toSafeUser() (routes/auth.js, payload
// client sau đăng nhập), không sửa rải rác canEditProfiles()/canManageContracts()/currentUser.perms?...
// ở hàng chục chỗ khác trong hệ thống.
//
// Đã xác nhận TRỰC TIẾP với người dùng qua 3 vòng hỏi đáp trước khi làm (AskUserQuestion):
//   1. Trạng thái hồ sơ/hợp đồng + Chức vụ/Phòng Ban/Cấp Bậc VẪN đi qua đúng luồng nghiệp vụ riêng có
//      validate ràng buộc (PATCH .../status, POST .../set-position, .../activate...) — KHÔNG có đường
//      tắt ghi thẳng, KHÔNG bypass assertValidManualStatusTransition()/assertReadyToActivate().
//   2. Mã Nhân Viên/Mã Hợp Đồng khoá cứng — không bao giờ sửa được (cấu trúc: không nằm trong bất kỳ
//      danh sách field nào applyProfileEdit()/applyManualEdit() chấp nhận ghi, bất kể quyền gì).
//   3. Phạm vi THẬT chỉ là GỘP 2 quyền hiện có (hrProfileEdit + hrContractManage) thành 1 nút bật —
//      KHÔNG mở thêm field nào khác đang bị khoá thật sự (đã rà soát kỹ, xem lib/auth.js).
//
// 2 phần:
//   A) Unit test thuần cho expandHrFullEditPerms() (lib/auth.js) — không cần HTTP.
//   B) Dựng Express app THẬT mount CẢ routes/employeeProfile.js LẪN routes/records.js (phần
//      laborContracts), stub lib/auth.js NHƯNG tái dùng ĐÚNG expandHrFullEditPerms() THẬT (require
//      lib/auth TRƯỚC khi stub để lấy hàm gốc) — xác nhận hành vi THẬT ở tầng route, không phải suy diễn
//      từ code đọc được.
//
// Chạy: node server/tests/test-hr-profile-contract-full-edit-perm.js
'use strict';

const assert = require('assert');
const path = require('path');
const http = require('http');
const express = require('express');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

// ===================== Phần A: expandHrFullEditPerms() thuần =====================
function partA() {
  console.log('\n== Phần A: expandHrFullEditPerms() (lib/auth.js, thuần) ==');
  const { expandHrFullEditPerms } = require('../lib/auth');

  return Promise.resolve().then(async () => {
    await test('Không có hrProfileContractFullEdit -> trả về NGUYÊN VẸN object perms cũ (không clone thừa)', () => {
      const perms = { hrProfileEdit: false, hrContractManage: false, admin: false };
      const out = expandHrFullEditPerms(perms);
      assert.strictEqual(out, perms, 'Phải trả về ĐÚNG tham chiếu cũ khi không có quyền gộp (tránh tạo object thừa mỗi request)');
    });

    await test('perms rỗng/undefined -> không lỗi, trả về nguyên trạng', () => {
      assert.strictEqual(expandHrFullEditPerms(undefined), undefined);
      assert.strictEqual(expandHrFullEditPerms(null), null);
      const empty = {};
      assert.strictEqual(expandHrFullEditPerms(empty), empty);
    });

    await test('Có hrProfileContractFullEdit=true -> trả về BẢN SAO với hrProfileEdit=true + hrContractManage=true', () => {
      const perms = { hrProfileContractFullEdit: true };
      const out = expandHrFullEditPerms(perms);
      assert.notStrictEqual(out, perms, 'Phải là bản sao (clone), không mutate object gốc');
      assert.strictEqual(out.hrProfileEdit, true);
      assert.strictEqual(out.hrContractManage, true);
      assert.strictEqual(out.hrProfileContractFullEdit, true, 'Vẫn giữ nguyên cờ gốc');
      // Object GỐC không bị mutate — quan trọng vì perms có thể là tham chiếu CHUNG từ cache users.
      assert.strictEqual(perms.hrProfileEdit, undefined, 'Object GỐC không được mutate');
    });

    await test('KHÔNG tự thêm hrProfileManage/hrProfileCreate — chỉ đúng 2 field đã xác nhận', () => {
      const out = expandHrFullEditPerms({ hrProfileContractFullEdit: true });
      assert.strictEqual(!!out.hrProfileManage, false, 'Không được kèm hrProfileManage (sẽ kéo theo tạo mới hồ sơ — ngoài phạm vi "sửa")');
      assert.strictEqual(!!out.hrProfileCreate, false, 'Không được kèm hrProfileCreate');
    });

    await test('Đã có hrProfileEdit/hrContractManage=true sẵn + thêm cờ gộp -> vẫn true, không đổi gì khác (idempotent)', () => {
      const perms = { hrProfileContractFullEdit: true, hrProfileEdit: true, hrContractManage: true, hrProfileView: true };
      const out = expandHrFullEditPerms(perms);
      assert.strictEqual(out.hrProfileEdit, true);
      assert.strictEqual(out.hrContractManage, true);
      assert.strictEqual(out.hrProfileView, true, 'Field khác không liên quan giữ nguyên');
    });
  });
}

// ===================== Phần B: HTTP thật (employeeProfile.js + records.js laborContracts) =====================
async function partB() {
  console.log('\n== Phần B: HTTP thật — Hồ Sơ Nhân Sự + Hợp Đồng Lao Động ==');

  // Lấy hàm GỐC THẬT trước khi stub lib/auth — stub bên dưới tái dùng ĐÚNG hàm này, không viết lại logic
  // riêng (tránh lệch giữa test và code thật, đúng bài học "rải rác kiểm tra quyền dễ sót" đã rút ra).
  const { expandHrFullEditPerms } = require('../lib/auth');

  function stubModule(relPath, exportsObj) {
    const full = require.resolve(path.join(__dirname, '..', relPath));
    require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
    return exportsObj;
  }

  const NOPERM = { username: 'noperm1', name: 'Không Quyền Gì', dept: 'Kinh Doanh', perms: {}, active: true };
  const FULL = { username: 'full1', name: 'Toàn Quyền Sửa NS+HĐLĐ', dept: 'Phòng Nhân Sự', perms: { hrProfileContractFullEdit: true }, active: true };
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', perms: { admin: true }, active: true };
  // LINKED_TARGET (12/2026, cho kịch bản syncAccountContact — xem routes/employeeProfile.js) — tài khoản
  // VPDT đóng vai "nhân viên thật" đã liên kết với hồ sơ FE002, dùng để xác nhận email/phone đồng bộ
  // ĐÚNG xuống đúng tài khoản này (không phải tài khoản actor đang thao tác, FULL).
  const LINKED_TARGET = { username: 'nv.linked', name: 'Nhân Viên Đã Liên Kết', dept: 'Kinh Doanh', perms: {}, active: true, email: 'email.cu@hcrc.vn', phone: '0900000000' };
  const USERS = [NOPERM, FULL, ADMIN, LINKED_TARGET];

  let CURRENT_USERNAME = FULL.username;
  stubModule('lib/auth', {
    // Mirror ĐÚNG requireAuth() thật (lib/auth.js): clone perms qua expandHrFullEditPerms() khi có cờ
    // gộp, giữ nguyên tham chiếu khi không có — xem chú thích đầy đủ ở lib/auth.js.
    requireAuth: (req, res, next) => {
      const fresh = USERS.find(u => u.username === CURRENT_USERNAME);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, admin: !!fresh.perms?.admin };
      req.freshUser = fresh.perms?.hrProfileContractFullEdit
        ? { ...fresh, perms: expandHrFullEditPerms(fresh.perms) }
        : fresh;
      req.allUsers = USERS;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });

  const EMPLOYEE_PROFILES = [{
    employeeCode: 'FE001', username: null, status: 'ACTIVE',
    currentAddress: 'Địa chỉ cũ', nationalId: null, dateOfBirth: null, gender: null,
    createdAt: '', updatedAt: '', profileEditHistory: []
  }, {
    // FE002 (12/2026) — hồ sơ ĐÃ liên kết tài khoản LINKED_TARGET, dùng cho kịch bản syncAccountContact.
    employeeCode: 'FE002', username: LINKED_TARGET.username, status: 'ACTIVE',
    workEmail: null, contactPhone: null, nationalId: null, dateOfBirth: null, gender: null,
    createdAt: '', updatedAt: '', profileEditHistory: []
  }];
  stubModule('lib/appData', {
    getAppDataValue: async (key) => {
      if (key === 'users') return USERS;
      if (key === 'employeeProfiles') return EMPLOYEE_PROFILES;
      return null;
    },
    getAllAppData: async () => ({ users: USERS, employeeProfiles: EMPLOYEE_PROFILES, depts: ['Phòng Nhân Sự', 'Kinh Doanh'], stores: [] }),
    // 'users' (12/2026, thêm cho kịch bản syncAccountContact — xem routes/employeeProfile.js) — mutate
    // THẲNG mảng USERS thật (giữ tham chiếu) để test đọc lại được giá trị đã đồng bộ, cùng khuôn
    // 'employeeProfiles' ngay dưới.
    withLockedAppDataValue: async (key, fn) => {
      if (key === 'employeeProfiles') return fn(EMPLOYEE_PROFILES);
      if (key === 'users') {
        const result = await fn(USERS);
        if (Array.isArray(result)) { USERS.length = 0; USERS.push(...result); }
        return result;
      }
      return fn([]);
    }
  });

  const LABOR_CONTRACTS = [{
    id: 1, code: 'HDLD-FE001-1', employeeCode: 'FE001', employeeUsername: null, contractType: 'PROBATION',
    status: 'DRAFT', startDate: '2026-01-01', endDate: '2026-03-01', baseSalary: 8000000,
    renewalIndex: 0, history: [], amendments: [], notifiedThresholds: []
  }];
  stubModule('lib/recordStore', {
    MIGRATED_COLLECTIONS: new Set(['laborContracts']),
    getAllForCollection: async (c) => (c === 'laborContracts' ? LABOR_CONTRACTS.slice() : []),
    withAppLock: async (lockKey, fn) => fn(),
    withLockedRecordForCollection: async (c, id, mutatorFn) => {
      const list = c === 'laborContracts' ? LABOR_CONTRACTS : [];
      const idx = list.findIndex(x => x.id === Number(id));
      if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy bản ghi'); }
      list[idx] = await mutatorFn(list[idx]);
      return list[idx];
    }
  });

  const employeeProfileRoutes = require('../routes/employeeProfile');
  const recordRoutes = require('../routes/records');
  const app = express();
  app.use(express.json());
  app.use('/api/hr-profile', employeeProfileRoutes);
  app.use('/api/records', recordRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const base = `http://127.0.0.1:${port}`;
  async function call(user, method, urlPath, body) {
    CURRENT_USERNAME = user.username;
    const res = await fetch(`${base}${urlPath}`, {
      method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let json = null; try { json = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, json };
  }

  try {
    // ---- Hồ Sơ Nhân Sự ----
    await test('NOPERM: PATCH /by-code/:code (sửa field thường) -> 403', async () => {
      const r = await call(NOPERM, 'PATCH', '/api/hr-profile/by-code/FE001', { currentAddress: 'Địa chỉ mới' });
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
    });

    await test('FULL (chỉ hrProfileContractFullEdit): PATCH /by-code/:code sửa field thường -> 200, giá trị đổi', async () => {
      const r = await call(FULL, 'PATCH', '/api/hr-profile/by-code/FE001', { currentAddress: 'Địa chỉ mới', nationalId: '079099001234' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.profile.currentAddress, 'Địa chỉ mới');
      assert.strictEqual(r.json.profile.nationalId, '079099001234', 'Phải sửa được CẢ field HR-only (nationalId), không chỉ field tự phục vụ');
    });

    await test('FULL: gửi kèm employeeCode trong payload PATCH -> KHÔNG đổi (Mã Nhân Viên khoá cứng, không nằm trong allowed-list)', async () => {
      const r = await call(FULL, 'PATCH', '/api/hr-profile/by-code/FE001', { employeeCode: 'FE999', currentAddress: 'Vẫn sửa được field khác' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.profile.employeeCode, 'FE001', 'employeeCode phải giữ NGUYÊN dù có quyền gộp');
    });

    await test('FULL: PATCH /by-code/:code/status — chuyển ACTIVE->ON_LEAVE (hợp lệ) -> 200 (vẫn đi qua đúng route nghiệp vụ riêng)', async () => {
      const r = await call(FULL, 'PATCH', '/api/hr-profile/by-code/FE001/status', { status: 'ON_LEAVE' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.profile.status, 'ON_LEAVE');
    });

    await test('FULL: PATCH /by-code/:code/status — chuyển sang DRAFT (KHÔNG hợp lệ) -> VẪN BỊ CHẶN 400 (không bypass assertValidManualStatusTransition)', async () => {
      const r = await call(FULL, 'PATCH', '/api/hr-profile/by-code/FE001/status', { status: 'DRAFT' });
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
    });

    await test('FULL: POST /api/hr-profile (tạo hồ sơ MỚI) -> 403 (KHÔNG kèm hrProfileCreate, quyền gộp chỉ để SỬA)', async () => {
      const r = await call(FULL, 'POST', '/api/hr-profile', { employeeCode: 'FE003', dateOfBirth: '1995-01-01' });
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
    });

    // ===================================================================================
    // syncAccountContact (12/2026, phản hồi TRỰC TIẾP người dùng: "không đồng bộ từ VPDT mà tôi yêu cầu
    // đồng bộ 2 trường email và SĐT từ hồ sơ NS hoặc Onboarding sang [tài khoản VPDT]") — xem chú thích
    // đầy đủ tại nơi gán biến này ở routes/employeeProfile.js.
    // ===================================================================================
    await test('FULL: PATCH /by-code/FE002 sửa workEmail/contactPhone -> ĐỒNG BỘ XUỐNG tài khoản VPDT liên kết (nv.linked)', async () => {
      const r = await call(FULL, 'PATCH', '/api/hr-profile/by-code/FE002', { workEmail: 'email.moi@hcrc.vn', contactPhone: '0911222333' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.profile.workEmail, 'email.moi@hcrc.vn');
      const acc = USERS.find(u => u.username === LINKED_TARGET.username);
      assert.strictEqual(acc.email, 'email.moi@hcrc.vn', 'Email tài khoản VPDT phải được đồng bộ từ workEmail của hồ sơ');
      assert.strictEqual(acc.phone, '0911222333', 'SĐT tài khoản VPDT phải được đồng bộ từ contactPhone của hồ sơ');
    });

    await test('FULL: PATCH /by-code/FE002 sửa field KHÁC (không đụng workEmail/contactPhone) -> KHÔNG đổi gì email/SĐT tài khoản đang có', async () => {
      const before = USERS.find(u => u.username === LINKED_TARGET.username).email;
      const r = await call(FULL, 'PATCH', '/api/hr-profile/by-code/FE002', { currentAddress: 'Địa chỉ khác, không liên quan email/SĐT' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      const acc = USERS.find(u => u.username === LINKED_TARGET.username);
      assert.strictEqual(acc.email, before, 'KHÔNG được đụng tới email tài khoản khi payload không hề gửi workEmail');
    });

    await test('FULL: PATCH /by-code/FE002 gửi workEmail="" (xoá trắng) -> hồ sơ lưu rỗng nhưng KHÔNG xoá trắng email tài khoản đang có (chỉ đồng bộ khi giá trị MỚI khác rỗng)', async () => {
      const before = USERS.find(u => u.username === LINKED_TARGET.username).email;
      const r = await call(FULL, 'PATCH', '/api/hr-profile/by-code/FE002', { workEmail: '' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.profile.workEmail, '', 'Hồ sơ vẫn ghi nhận xoá trắng bình thường');
      const acc = USERS.find(u => u.username === LINKED_TARGET.username);
      assert.strictEqual(acc.email, before, 'KHÔNG được xoá trắng email đăng nhập của tài khoản chỉ vì HR lỡ để trống ô này trong hồ sơ');
    });

    // ---- Hợp Đồng Lao Động ----
    await test('NOPERM: POST /laborContracts/:id/edit -> 403', async () => {
      const r = await call(NOPERM, 'POST', '/api/records/laborContracts/1/edit', { baseSalary: 9000000 });
      assert.strictEqual(r.status, 403, JSON.stringify(r.json));
    });

    await test('FULL: POST /laborContracts/:id/edit sửa baseSalary/contractType -> 200', async () => {
      const r = await call(FULL, 'POST', '/api/records/laborContracts/1/edit', { baseSalary: 9500000, contractType: 'FIXED_TERM', startDate: '2026-01-01', endDate: '2026-12-31' });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.baseSalary, 9500000);
      assert.strictEqual(r.json.item.contractType, 'FIXED_TERM', 'Phải đổi được Loại Hợp Đồng trực tiếp (đã là field cho phép sửa tay từ trước, không phải mở mới)');
    });

    await test('FULL: gửi kèm code trong payload edit -> KHÔNG đổi (Mã Hợp Đồng khoá cứng, không nằm trong MANUAL_EDITABLE_FIELDS)', async () => {
      const r = await call(FULL, 'POST', '/api/records/laborContracts/1/edit', { code: 'HDLD-HACKED-1', baseSalary: 9600000 });
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.code, 'HDLD-FE001-1', 'code phải giữ NGUYÊN dù có quyền gộp');
      assert.strictEqual(r.json.item.baseSalary, 9600000, 'field khác trong CÙNG request vẫn sửa được bình thường');
    });

    await test('FULL: POST /laborContracts/:id/activate (DRAFT -> ACTIVE) -> 200 (vẫn qua đúng route nghiệp vụ riêng, không bị chặn)', async () => {
      const r = await call(FULL, 'POST', '/api/records/laborContracts/1/activate', {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.status, 'ACTIVE');
    });
  } finally {
    server.close();
  }
}

async function main() {
  await partA();
  await partB();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
