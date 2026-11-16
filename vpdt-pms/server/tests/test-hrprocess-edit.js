// tests/test-hrprocess-edit.js
//
// "✏️ Sửa Quy Trình" (11/2026, theo yêu cầu người dùng — "hủy như này nó bị rác hồ sơ... có cho phép
// sửa để nó chạy tiếp đến lúc hoàn thành thì thôi"): trước đây 1 quy trình Onboarding/Offboarding gõ
// sai thông tin (VD sai Mã Nhân Viên) chỉ có "Hủy" (giữ bản ghi "Đã huỷ" MÃI MÃI, gây rối màn theo dõi
// tiến độ, mất hết checklist đã làm). editHrProcess() (lib/recordActions.js) thêm action "Sửa" cho quy
// trình ĐANG THỰC HIỆN — sửa đúng field ĐỊNH DANH hay gõ sai, KHÔNG đụng checklist. employeeCode
// (ONBOARDING) đổi được — route POST /hrProcesses/:id/edit (routes/records.js) tự đồng bộ lại hồ sơ
// employeeProfiles DRAFT đặt chỗ sau đó (syncDraftProfileOnOnboardingEdited()), kể cả BACKFILL hồ sơ
// DRAFT cho quy trình TỪ TRƯỚC TỚI GIỜ chưa từng có hồ sơ nào (dữ liệu cũ).
//
// Chạy: node server/tests/test-hrprocess-edit.js
'use strict';

const assert = require('assert');
const express = require('express');
const http = require('http');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(require('path').join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: require('path').dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err && err.stack ? err.stack : err}`); }
}

// ===================== Phần A: lib/recordActions.js::editHrProcess() (thuần) =====================
function partA() {
  console.log('== Phần A: recordActions.editHrProcess() (thuần) ==');
  const recordActions = require('../lib/recordActions');
  const HR1 = { username: 'hr1', name: 'Nhân Sự Một', perms: { hrOnboardingManage: true } };
  const EMP1 = { username: 'emp1', name: 'Nhân Viên Thường', perms: {} };

  function freshOnboarding(overrides) {
    return Object.assign({
      id: 1, processType: 'ONBOARDING', status: 'IN_PROGRESS', creator: 'hr1',
      employeeCode: 'BL0001', fullName: 'Nguyễn Văn A', employeePosType: 'HO',
      employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Nhân viên Kế Toán',
      email: '', phone: '0900000001', startDate: '2026-01-01', targetEndDate: '2026-03-01',
      history: []
    }, overrides);
  }
  function freshOffboarding(overrides) {
    return Object.assign({
      id: 2, processType: 'OFFBOARDING', status: 'IN_PROGRESS', creator: 'hr1',
      employeeUsername: 'kd1', fullName: 'Nguyễn Văn B', employeeDept: 'Phòng Kinh Doanh',
      lastWorkingDate: '2026-02-01', targetEndDate: '2026-02-01', reason: '', resignationReason: null, note: '',
      history: []
    }, overrides);
  }
  const APP_DATA = {
    depts: ['Phòng Kế Toán', 'Phòng Kinh Doanh'], stores: ['Siêu thị Quận 1'],
    jobTitles: ['Nhân viên Kế Toán', 'Trưởng Phòng Kế Toán'], storeJobTitles: [{ label: 'Nhân viên Siêu thị' }],
    employeeProfiles: [], hrProcesses: []
  };

  test('editHrProcess(): người không có hrOnboardingManage/không phải creator bị chặn 403', () => {
    const item = freshOnboarding();
    assert.throws(() => recordActions.editHrProcess(EMP1, item, { fullName: 'Khác' }, APP_DATA), /không có quyền sửa/i);
  });

  test('editHrProcess(): quy trình KHÔNG còn IN_PROGRESS (đã Hoàn tất) -> 409', () => {
    const item = freshOnboarding({ status: 'COMPLETED' });
    assert.throws(() => recordActions.editHrProcess(HR1, item, { fullName: 'Khác' }, APP_DATA), /409|không còn ở trạng thái/i);
  });

  test('editHrProcess(): không gửi field nào thay đổi -> 400 "Không có thay đổi"', () => {
    const item = freshOnboarding();
    assert.throws(() => recordActions.editHrProcess(HR1, item, { fullName: 'Nguyễn Văn A' }, APP_DATA), /không có thay đổi/i);
  });

  test('editHrProcess(): ONBOARDING sửa Họ Tên -> thành công, ghi 1 dòng history EDITED, KHÔNG đụng field khác', () => {
    const item = freshOnboarding();
    const result = recordActions.editHrProcess(HR1, item, { fullName: 'Nguyễn Văn A Đã Sửa' }, APP_DATA);
    assert.strictEqual(result.fullName, 'Nguyễn Văn A Đã Sửa');
    assert.strictEqual(result.employeeCode, 'BL0001', 'không đụng field khác');
    assert.strictEqual(result.history.length, 1);
    assert.strictEqual(result.history[0].action, 'EDITED');
    assert.ok(result.history[0].detail.includes('fullName'));
  });

  test('editHrProcess(): ONBOARDING sửa Phòng Ban không có trong danh mục -> 400', () => {
    const item = freshOnboarding();
    assert.throws(() => recordActions.editHrProcess(HR1, item, { employeePosType: 'HO', employeeDept: 'Phòng Không Tồn Tại', employeeJobTitle: 'Nhân viên Kế Toán' }, APP_DATA), /phòng ban/i);
  });

  test('editHrProcess(): ONBOARDING đổi sang Siêu Thị nhưng để trống Email -> 400 bắt buộc Email', () => {
    const item = freshOnboarding();
    assert.throws(() => recordActions.editHrProcess(HR1, item, { employeePosType: 'STORE', employeeDept: 'Siêu thị Quận 1', employeeJobTitle: 'Nhân viên Siêu thị', email: '' }, APP_DATA), /bắt buộc phải nhập email/i);
  });

  test('editHrProcess(): ONBOARDING sửa Mã Nhân Viên sang mã đang gắn hồ sơ ACTIVE người khác -> 409', () => {
    const item = freshOnboarding();
    const appData = Object.assign({}, APP_DATA, { employeeProfiles: [{ employeeCode: 'BL0002', status: 'ACTIVE', processId: 99 }] });
    assert.throws(() => recordActions.editHrProcess(HR1, item, { employeeCode: 'BL0002' }, appData), /đang gắn với 1 hồ sơ đang hoạt động khác/i);
  });

  test('editHrProcess(): ONBOARDING sửa Mã Nhân Viên sang mã đang dùng ở 1 quy trình Onboarding IN_PROGRESS khác -> 409', () => {
    const item = freshOnboarding();
    const appData = Object.assign({}, APP_DATA, { hrProcesses: [freshOnboarding({ id: 5, employeeCode: 'BL0005' })] });
    assert.throws(() => recordActions.editHrProcess(HR1, item, { employeeCode: 'BL0005' }, appData), /đang được dùng ở 1 quy trình Onboarding khác/i);
  });

  test('editHrProcess(): ONBOARDING sửa Mã Nhân Viên sang mã CHƯA ai dùng -> thành công, changedFields ghi "employeeCode"', () => {
    const item = freshOnboarding();
    const result = recordActions.editHrProcess(HR1, item, { employeeCode: 'BL9999' }, APP_DATA);
    assert.strictEqual(result.employeeCode, 'BL9999');
    assert.ok(result.history[0].detail.includes('employeeCode'));
  });

  test('editHrProcess(): ONBOARDING sửa Mã Nhân Viên sang mã đang gắn hồ sơ DRAFT/INACTIVE -> cho phép (không chặn oan)', () => {
    const item = freshOnboarding();
    const appData = Object.assign({}, APP_DATA, { employeeProfiles: [{ employeeCode: 'BL0003', status: 'DRAFT', processId: null }] });
    const result = recordActions.editHrProcess(HR1, item, { employeeCode: 'BL0003' }, appData);
    assert.strictEqual(result.employeeCode, 'BL0003');
  });

  test('editHrProcess(): OFFBOARDING sửa Ngày nghỉ dự kiến -> targetEndDate tự đồng bộ theo lastWorkingDate (đúng khuôn lúc tạo)', () => {
    const item = freshOffboarding();
    const result = recordActions.editHrProcess(HR1, item, { lastWorkingDate: '2026-03-15' }, APP_DATA);
    assert.strictEqual(result.lastWorkingDate, '2026-03-15');
    assert.strictEqual(result.targetEndDate, '2026-03-15');
  });

  test('editHrProcess(): OFFBOARDING sửa Lý do nghỉ việc/Ghi chú -> thành công', () => {
    const item = freshOffboarding();
    const result = recordActions.editHrProcess(HR1, item, { resignationReason: 'Chuyển việc khác', note: 'Đã bàn giao xong việc A' }, APP_DATA);
    assert.strictEqual(result.resignationReason, 'Chuyển việc khác');
    assert.strictEqual(result.note, 'Đã bàn giao xong việc A');
  });

  test('editHrProcess(): OFFBOARDING gửi kèm employeeUsername trong body -> bị LỜ ĐI hoàn toàn (không có field nào cho sửa Tài Khoản ở action này)', () => {
    const item = freshOffboarding();
    const result = recordActions.editHrProcess(HR1, item, { employeeUsername: 'ketoan1', note: 'ghi chú mới' }, APP_DATA);
    assert.strictEqual(result.employeeUsername, 'kd1', 'Tài Khoản KHÔNG được đổi dù body có gửi kèm');
    assert.strictEqual(result.note, 'ghi chú mới');
  });

  test('editHrProcess(): creator (không có hrOnboardingManage) vẫn sửa được quy trình CHÍNH MÌNH tạo', () => {
    const item = freshOnboarding({ creator: 'emp1' });
    const result = recordActions.editHrProcess(EMP1, item, { fullName: 'Sửa bởi creator' }, APP_DATA);
    assert.strictEqual(result.fullName, 'Sửa bởi creator');
  });
}

// ===================== Phần B: HTTP thật (Express + recordStore/appData in-memory) =====================
async function partB() {
  console.log('\n== Phần B: HTTP thật — POST /api/records/hrProcesses/:id/edit ==');

  const STORE = { hrProcesses: [
    { id: 1, processType: 'ONBOARDING', status: 'IN_PROGRESS', creator: 'hr1', employeeCode: 'BL1001', fullName: 'Ứng Viên A',
      employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Nhân viên Kế Toán', email: '', phone: '0911',
      startDate: '2026-01-01', targetEndDate: '2026-03-01', history: [] },
    { id: 2, processType: 'OFFBOARDING', status: 'IN_PROGRESS', creator: 'hr1', employeeUsername: 'kd1', fullName: 'Nhân Viên B',
      employeeDept: 'Phòng Kinh Doanh', lastWorkingDate: '2026-02-01', targetEndDate: '2026-02-01', reason: '', note: '', history: [] },
    // #3: quy trình "mồ côi" KHÔNG hề có hồ sơ DRAFT nào trong PROFILES (mô phỏng dữ liệu CŨ trước khi
    // chặn điền tay Mã Nhân Viên ở Nhập Excel hàng loạt — xem lib/hrProcessCreateImport.js cùng đợt).
    { id: 3, processType: 'ONBOARDING', status: 'IN_PROGRESS', creator: 'hr1', employeeCode: 'BL1003', fullName: 'Mồ Côi C',
      employeePosType: 'HO', employeeDept: 'Phòng Kế Toán', employeeJobTitle: 'Nhân viên Kế Toán', email: '', phone: '0913',
      startDate: '2026-01-01', targetEndDate: '2026-03-01', history: [] }
  ] };
  let PROFILES = [
    { employeeCode: 'BL1001', status: 'DRAFT', processId: 1, onboardingQueueStatus: 'PENDING' }
    // CỐ Ý không có profile nào cho BL1003 -> test backfill.
  ];
  const USERS = [
    { username: 'hr1', name: 'Nhân Sự Một', perms: { hrOnboardingManage: true, hrOffboardingManage: true }, active: true },
    { username: 'emp1', name: 'Nhân Viên Thường', perms: {}, active: true }
  ];
  stubModule('lib/recordStore', {
    MIGRATED_COLLECTIONS: new Set(['hrProcesses']),
    getAllForCollection: async (c) => (STORE[c] || []).slice(),
    getAllForCollectionCached: async (c) => (STORE[c] || []).slice(),
    withLockedRecordForCollection: async (collection, id, mutatorFn) => {
      const arr = STORE[collection];
      const idx = arr.findIndex(it => it.id === id);
      if (idx === -1) { const { HttpError } = require('../lib/httpErrors'); throw new HttpError(404, 'Không tìm thấy hồ sơ'); }
      const result = await mutatorFn(arr[idx]);
      arr[idx] = result;
      return result;
    }
  });
  stubModule('lib/auth', {
    requireAuth: (req, res, next) => {
      const username = req.headers['x-demo-user'];
      const fresh = USERS.find(u => u.username === username);
      if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
      req.user = { username: fresh.username, name: fresh.name };
      req.freshUser = fresh;
      req.allUsers = USERS;
      next();
    },
    blockIfMustChangePassword: (req, res, next) => next()
  });
  stubModule('lib/appData', {
    getAppDataValue: async (key) => (key === 'users' ? USERS : (key === 'employeeProfiles' ? PROFILES : (key === 'hrProcesses' ? STORE.hrProcesses : null))),
    getAllAppData: async () => ({
      users: USERS, depts: ['Phòng Kế Toán', 'Phòng Kinh Doanh'], stores: ['Siêu thị Quận 1'],
      jobTitles: ['Nhân viên Kế Toán'], storeJobTitles: [{ label: 'Nhân viên Siêu thị' }]
    }),
    withLockedAppDataValue: async (key, fn) => {
      if (key === 'employeeProfiles') { const res = await fn(PROFILES); PROFILES = Array.isArray(res) ? res : PROFILES; return PROFILES; }
      return fn([]);
    }
  });

  const recordRoutes = require('../routes/records');
  const app = express();
  app.use(express.json());
  app.use('/api/records', recordRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
  const base = `http://127.0.0.1:${port}`;
  async function call(username, method, urlPath, body) {
    const res = await fetch(`${base}${urlPath}`, {
      method, headers: Object.assign({ 'x-demo-user': username }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json };
  }

  await test('POST /hrProcesses/:id/edit: người không có quyền bị chặn 403', async () => {
    const r = await call('emp1', 'POST', '/api/records/hrProcesses/1/edit', { fullName: 'X' });
    assert.strictEqual(r.status, 403, JSON.stringify(r.json));
  });

  await test('POST /hrProcesses/:id/edit: id không tồn tại -> 404', async () => {
    const r = await call('hr1', 'POST', '/api/records/hrProcesses/999/edit', { fullName: 'X' });
    assert.strictEqual(r.status, 404, JSON.stringify(r.json));
  });

  await test('POST /hrProcesses/:id/edit: sửa Mã Nhân Viên ONBOARDING -> đổi thành công, hồ sơ DRAFT cũ được gỡ liên kết, hồ sơ mã mới được tạo/link PENDING (draftProfileSynced=true)', async () => {
    const r = await call('hr1', 'POST', '/api/records/hrProcesses/1/edit', { employeeCode: 'BL1001-FIXED' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.item.employeeCode, 'BL1001-FIXED');
    assert.strictEqual(r.json.draftProfileSynced, true);
    const oldProfile = PROFILES.find(p => p.employeeCode === 'BL1001');
    assert.ok(oldProfile, 'hồ sơ cũ KHÔNG bị xoá (khác hẳn Huỷ quy trình)');
    assert.strictEqual(oldProfile.processId, null, 'hồ sơ cũ phải được gỡ processId');
    assert.strictEqual(oldProfile.onboardingQueueStatus, null, 'hồ sơ cũ phải được gỡ khỏi hàng đợi');
    const newProfile = PROFILES.find(p => p.employeeCode === 'BL1001-FIXED');
    assert.ok(newProfile, 'phải tự tạo hồ sơ DRAFT mới ở mã đã sửa');
    assert.strictEqual(newProfile.processId, 1);
    assert.strictEqual(newProfile.onboardingQueueStatus, 'PENDING', 'phải vào lại hàng đợi Onboarding để HR Xác Nhận được');
  });

  await test('POST /hrProcesses/:id/edit: quy trình "mồ côi" (chưa từng có hồ sơ DRAFT) -> sửa field bất kỳ cũng tự BACKFILL hồ sơ DRAFT mới vào hàng đợi PENDING', async () => {
    assert.ok(!PROFILES.find(p => p.employeeCode === 'BL1003'), 'trước khi sửa: chưa có hồ sơ nào cho BL1003');
    const r = await call('hr1', 'POST', '/api/records/hrProcesses/3/edit', { phone: '0999888777' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.draftProfileSynced, true);
    const profile = PROFILES.find(p => p.employeeCode === 'BL1003');
    assert.ok(profile, 'phải tự tạo bù hồ sơ DRAFT — HR cuối cùng cũng Xác Nhận được');
    assert.strictEqual(profile.processId, 3);
    assert.strictEqual(profile.onboardingQueueStatus, 'PENDING');
  });

  await test('POST /hrProcesses/:id/edit: sửa OFFBOARDING (Ngày nghỉ dự kiến) -> thành công, KHÔNG đụng gì tới employeeProfiles (draftProfileSynced=false)', async () => {
    const r = await call('hr1', 'POST', '/api/records/hrProcesses/2/edit', { lastWorkingDate: '2026-04-01' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.item.lastWorkingDate, '2026-04-01');
    assert.strictEqual(r.json.item.targetEndDate, '2026-04-01');
    assert.strictEqual(r.json.draftProfileSynced, false);
  });

  await test('POST /hrProcesses/:id/edit: quy trình đã CANCELLED -> 409, không sửa được nữa', async () => {
    STORE.hrProcesses.push({ id: 4, processType: 'ONBOARDING', status: 'CANCELLED', creator: 'hr1', employeeCode: 'BL1004', fullName: 'Đã Huỷ', history: [] });
    const r = await call('hr1', 'POST', '/api/records/hrProcesses/4/edit', { fullName: 'Sửa Lại' });
    assert.strictEqual(r.status, 409, JSON.stringify(r.json));
  });

  // ===== "🔄 Đồng Bộ Hồ Sơ Nháp" (POST /hrProcesses/:id/sync-draft-profile) — theo yêu cầu người dùng:
  // "4 mã đang xử lý... cho nó thành 4 hồ sơ ở onboarding" (quy trình "mồ côi" KHÔNG hiện trong hàng đợi
  // "🕐 Hồ Sơ Onboarding" dù vẫn đang thực hiện bình thường) — nút RIÊNG, không cần bịa 1 field thay đổi
  // giả để kích hoạt editHrProcess() như test ở trên (BL1003).
  STORE.hrProcesses.push(
    { id: 5, processType: 'ONBOARDING', status: 'IN_PROGRESS', creator: 'hr1', employeeCode: 'BL1005', fullName: 'Mồ Côi D', history: [] },
    { id: 6, processType: 'ONBOARDING', status: 'CANCELLED', creator: 'hr1', employeeCode: 'BL1006', fullName: 'Đã Huỷ Khác', history: [] },
    { id: 7, processType: 'OFFBOARDING', status: 'IN_PROGRESS', creator: 'hr1', employeeUsername: 'kd2', fullName: 'Nhân Viên E', employeeDept: 'Phòng Kinh Doanh', lastWorkingDate: '2026-05-01', targetEndDate: '2026-05-01', reason: '', note: '', history: [] }
  );

  await test('POST /hrProcesses/:id/sync-draft-profile: người không có quyền bị chặn 403', async () => {
    const r = await call('emp1', 'POST', '/api/records/hrProcesses/5/sync-draft-profile', {});
    assert.strictEqual(r.status, 403, JSON.stringify(r.json));
  });

  await test('POST /hrProcesses/:id/sync-draft-profile: id không tồn tại -> 404', async () => {
    const r = await call('hr1', 'POST', '/api/records/hrProcesses/999/sync-draft-profile', {});
    assert.strictEqual(r.status, 404, JSON.stringify(r.json));
  });

  await test('POST /hrProcesses/:id/sync-draft-profile: OFFBOARDING -> 400 (chỉ áp dụng Onboarding)', async () => {
    const r = await call('hr1', 'POST', '/api/records/hrProcesses/7/sync-draft-profile', {});
    assert.strictEqual(r.status, 400, JSON.stringify(r.json));
  });

  await test('POST /hrProcesses/:id/sync-draft-profile: quy trình đã CANCELLED -> 409', async () => {
    const r = await call('hr1', 'POST', '/api/records/hrProcesses/6/sync-draft-profile', {});
    assert.strictEqual(r.status, 409, JSON.stringify(r.json));
  });

  await test('POST /hrProcesses/:id/sync-draft-profile: quy trình "mồ côi" -> tự BACKFILL hồ sơ DRAFT mới vào hàng đợi PENDING, KHÔNG cần sửa field nào, KHÔNG đụng hrProcesses (không trả "item")', async () => {
    assert.ok(!PROFILES.find(p => p.employeeCode === 'BL1005'), 'trước khi đồng bộ: chưa có hồ sơ nào cho BL1005');
    const r = await call('hr1', 'POST', '/api/records/hrProcesses/5/sync-draft-profile', {});
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.draftProfileSynced, true);
    assert.strictEqual(r.json.item, undefined, 'route này KHÔNG mutate/trả lại hrProcesses');
    const profile = PROFILES.find(p => p.employeeCode === 'BL1005');
    assert.ok(profile, 'phải tự tạo bù hồ sơ DRAFT — HR cuối cùng cũng thấy quy trình này trong hàng đợi');
    assert.strictEqual(profile.processId, 5);
    assert.strictEqual(profile.onboardingQueueStatus, 'PENDING');
  });

  await test('POST /hrProcesses/:id/sync-draft-profile: gọi LẠI LẦN NỮA sau khi đã đồng bộ -> vẫn 200/true (mirror ĐÚNG syncDraftProfileOnOnboardingEdited() — hồ sơ còn DRAFT thì luôn báo true, idempotent, KHÔNG tạo thêm hồ sơ trùng)', async () => {
    const before = PROFILES.length;
    const r = await call('hr1', 'POST', '/api/records/hrProcesses/5/sync-draft-profile', {});
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.draftProfileSynced, true);
    assert.strictEqual(PROFILES.length, before, 'không được tạo thêm hồ sơ trùng');
  });

  await test('POST /hrProcesses/:id/sync-draft-profile: hồ sơ đã CONFIRMED (không còn DRAFT) -> draftProfileSynced=false (không còn gì để đồng bộ, không hồi tố hồ sơ đã xác nhận)', async () => {
    STORE.hrProcesses.push({ id: 8, processType: 'ONBOARDING', status: 'IN_PROGRESS', creator: 'hr1', employeeCode: 'BL1008', fullName: 'Đã Xác Nhận', history: [] });
    PROFILES.push({ employeeCode: 'BL1008', status: 'ACTIVE', processId: 8, onboardingQueueStatus: 'CONFIRMED' });
    const r = await call('hr1', 'POST', '/api/records/hrProcesses/8/sync-draft-profile', {});
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.draftProfileSynced, false);
  });

  server.close();
}

(async () => {
  partA();
  await partB();
  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
