// server/tests/test-hr-onboarding-excel-fields.js
//
// Regression test cho đợt bổ sung field Onboarding/Hồ Sơ Nhân Sự đối chiếu file Excel "Trường Thông Tin
// Tạo Mã" (10/2026, theo yêu cầu người dùng):
//   1. Form Onboarding thu thập thêm: gender/dateOfBirth/permanentAddress/nationalIdIssueDate/
//      nationalIdIssuePlace/employmentType — ghi thẳng vào hồ sơ nháp employeeProfiles (mirror ĐÚNG cơ
//      chế currentAddress/nationalId đã có từ trước).
//   2. Học vấn (Trình độ/Trường/Chuyên ngành) — tạo sẵn 1 dòng education[] đầu tiên nếu nhập đủ Trình độ
//      + Trường (Chuyên ngành tuỳ chọn); thiếu 1 trong 2 -> 400 rõ ràng TRƯỚC KHI tạo hrProcesses.
//   3. Loại HĐLĐ/Hình thức làm việc/Thời gian/Thu nhập DỰ KIẾN — CHỈ lưu tham khảo trên CHÍNH bản ghi
//      hrProcesses (KHÔNG tự tạo/đổi gì ở laborContracts) — TÁI DÙNG nguyên CONTRACT_TYPES/ALLOWANCE_FIELDS
//      đã có của lib/laborContract.js.
//   4. employmentType (field MỚI, lib/employeeProfile.js) — validate enum + createManualProfile() (lối
//      tạo trực tiếp "Quản Lý Hồ Sơ > + Tạo Hồ Sơ Mới") cũng nhận được field này.
//
// Khuôn: mirror ĐÚNG tests/test-audit-nhansu-onboarding-contract.js (Express app thật mount routes/create.js,
// tầng lưu trữ in-memory riêng — KHÔNG đụng tới file test đó, tránh rủi ro cho bộ test hiện có).
//
// Chạy: node server/tests/test-hr-onboarding-excel-fields.js
'use strict';

const assert = require('assert');
const path = require('path');
const http = require('http');
const express = require('express');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.stack || err.message}`); }
}

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

const STORE = { hrProcesses: [] };
let nextId = 1;
const TRASH = [];
function resetStore() { STORE.hrProcesses = []; }

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(Object.keys(STORE)),
  getAllForCollection: async (c) => (STORE[c] || []).slice(),
  getAllForCollectionCached: async (c) => (STORE[c] || []).slice(),
  getTrashItems: async () => TRASH,
  withAppLock: async (key, fn) => fn(),
  createForCollection: async (c, builderFn) => {
    const draft = await builderFn((STORE[c] || []).slice());
    const item = Object.assign({ id: nextId++ }, draft);
    STORE[c] = STORE[c] || []; STORE[c].push(item);
    return item;
  },
  createForCollectionSerialized: async (c, lockKey, builderFn) => {
    const draft = await builderFn((STORE[c] || []).slice());
    const item = Object.assign({ id: nextId++ }, draft);
    STORE[c] = STORE[c] || []; STORE[c].push(item);
    return item;
  }
});

stubModule('lib/systemLogStore', { insertSystemLog: async (e) => e, querySystemLogs: async () => ({ items: [], total: 0 }) });

const USERS = [
  { username: 'onb1', name: 'Phụ Trách Onboarding', dept: 'Nhân Sự', perms: { hrOnboardingManage: true }, active: true }
];

let APP_DATA;
function resetAppData() {
  APP_DATA = {
    users: USERS,
    depts: ['Nhân Sự', 'Kinh Doanh'],
    stores: ['Siêu Thị 1'],
    jobTitles: ['Nhân Viên', 'Trưởng Phòng'],
    storeJobTitles: [{ label: 'Nhân Viên Bán Hàng' }],
    hrTaskTemplates: [],
    formTemplates: [],
    employeeProfiles: [],
    // employmentTypes/workSchedules (đợt "cho sửa/thêm sau" 10/2026) — mirror ĐÚNG danh mục mặc định
    // thật ở defaults.js, để extraValidate() (lib/createValidation.js) chặn NGAY giá trị lạ TRƯỚC KHI
    // hrProcesses được tạo (không rơi vào guard "catalog rỗng -> bỏ qua", vốn chỉ dành cho lúc admin lỡ
    // xoá trắng danh mục thật ngoài đời — xem test bên dưới xác nhận KHÔNG orphan hrProcesses).
    employmentTypes: ['Chính thức', 'Thời vụ', 'Bán thời gian', 'Cộng tác viên'],
    workSchedules: ['Giờ hành chính', 'Ca sáng', 'Ca chiều', 'Ca tối', 'Theo ca xoay']
  };
}
resetAppData(); resetStore();

stubModule('lib/appData', {
  getAppDataValue: async (key) => (key in APP_DATA ? APP_DATA[key] : null),
  getAllAppData: async () => APP_DATA,
  withLockedAppDataValue: async (key, fn) => { APP_DATA[key] = await fn(APP_DATA[key]); return APP_DATA[key]; }
});

let CURRENT_USER = 'onb1';
stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const fresh = USERS.find(u => u.username === CURRENT_USER);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const createRoutes = require('../routes/create');
const employeeProfile = require('../lib/employeeProfile');
const { CONTRACT_TYPES, ALLOWANCE_FIELDS } = require('../lib/laborContract');

function onboardingPayload(overrides) {
  return Object.assign({
    processType: 'ONBOARDING',
    fullName: 'Ứng Viên Mới',
    employeePosType: 'HO',
    employeeDept: 'Kinh Doanh',
    employeeJobTitle: 'Nhân Viên',
    email: 'ungvien@congty.vn',
    phone: '0900000000',
    startDate: '2026-11-02'
  }, overrides || {});
}

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  const server = http.createServer(app);
  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
  const base = `http://127.0.0.1:${port}`;
  async function call(method, urlPath, body) {
    const res = await fetch(`${base}${urlPath}`, {
      method, headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null; try { json = await res.json(); } catch (e) { /* no body */ }
    return { status: res.status, json };
  }

  try {
    console.log('\n== 1) Thông tin cá nhân bổ sung ghi thẳng vào hồ sơ nháp employeeProfiles ==');

    await test('gender/dateOfBirth/permanentAddress/nationalIdIssueDate/nationalIdIssuePlace/employmentType/workSchedule đủ nhập -> ghi đúng vào hồ sơ', async () => {
      resetAppData(); resetStore();
      const r = await call('POST', '/api/create/hrProcesses', onboardingPayload({
        gender: 'Nữ', dateOfBirth: '1998-05-20', permanentAddress: 'Số 1, Hà Nội',
        nationalIdIssueDate: '2015-01-10', nationalIdIssuePlace: 'CA Hà Nội', employmentType: 'Chính thức',
        workSchedule: 'Giờ hành chính'
      }));
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      const profile = APP_DATA.employeeProfiles.find(p => p.employeeCode === r.json.item.employeeCode);
      assert.ok(profile, 'Hồ sơ nháp phải tồn tại');
      assert.strictEqual(profile.gender, 'Nữ');
      assert.strictEqual(profile.dateOfBirth, '1998-05-20');
      assert.strictEqual(profile.permanentAddress, 'Số 1, Hà Nội');
      assert.strictEqual(profile.nationalIdIssueDate, '2015-01-10');
      assert.strictEqual(profile.nationalIdIssuePlace, 'CA Hà Nội');
      assert.strictEqual(profile.employmentType, 'Chính thức');
      assert.strictEqual(profile.workSchedule, 'Giờ hành chính');
    });

    await test('để trống toàn bộ field bổ sung -> vẫn tạo được bình thường (tuỳ chọn thật sự), hồ sơ giữ null như mặc định', async () => {
      resetAppData(); resetStore();
      const r = await call('POST', '/api/create/hrProcesses', onboardingPayload({}));
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      const profile = APP_DATA.employeeProfiles.find(p => p.employeeCode === r.json.item.employeeCode);
      assert.strictEqual(profile.gender, null);
      assert.strictEqual(profile.employmentType, null);
      assert.strictEqual(profile.workSchedule, null);
    });

    await test('gender KHÔNG hợp lệ -> 400, KHÔNG tạo quy trình hrProcesses nào (hồ sơ DRAFT đặt chỗ trước đó trở thành mồ côi — hành vi đã có từ trước, không phải lỗi mới)', async () => {
      resetAppData(); resetStore();
      const r = await call('POST', '/api/create/hrProcesses', onboardingPayload({ gender: 'XYZ' }));
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.strictEqual(STORE.hrProcesses.length, 0);
    });

    await test('employmentType KHÔNG hợp lệ -> 400, chặn NGAY TẠI extraValidate (đối chiếu appData.employmentTypes) TRƯỚC KHI hrProcesses được tạo', async () => {
      resetAppData(); resetStore();
      const r = await call('POST', '/api/create/hrProcesses', onboardingPayload({ employmentType: 'Không rõ' }));
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.strictEqual(STORE.hrProcesses.length, 0);
    });

    await test('workSchedule KHÔNG hợp lệ -> 400, chặn NGAY TẠI extraValidate (đối chiếu appData.workSchedules) TRƯỚC KHI hrProcesses được tạo', async () => {
      resetAppData(); resetStore();
      const r = await call('POST', '/api/create/hrProcesses', onboardingPayload({ workSchedule: 'Ca đêm khuya (không có trong danh mục)' }));
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.strictEqual(STORE.hrProcesses.length, 0);
    });

    await test('employmentType/workSchedule: admin tự thêm giá trị MỚI vào appData.employmentTypes/workSchedules (màn Biểu Mẫu) -> value mới được chấp nhận ngay, không cần đổi code', async () => {
      resetAppData(); resetStore();
      APP_DATA.employmentTypes = [...APP_DATA.employmentTypes, 'Thực tập sinh'];
      APP_DATA.workSchedules = [...APP_DATA.workSchedules, 'Làm từ xa'];
      const r = await call('POST', '/api/create/hrProcesses', onboardingPayload({ employmentType: 'Thực tập sinh', workSchedule: 'Làm từ xa' }));
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      const profile = APP_DATA.employeeProfiles.find(p => p.employeeCode === r.json.item.employeeCode);
      assert.strictEqual(profile.employmentType, 'Thực tập sinh');
      assert.strictEqual(profile.workSchedule, 'Làm từ xa');
    });

    console.log('\n== 2) Học vấn (Trình độ/Trường/Chuyên ngành) ==');

    await test('nhập đủ Trình độ + Trường (+ Chuyên ngành tuỳ chọn) -> tạo đúng 1 dòng education[] đầu tiên', async () => {
      resetAppData(); resetStore();
      const r = await call('POST', '/api/create/hrProcesses', onboardingPayload({
        eduDegree: 'Đại học', eduSchool: 'ĐH Kinh Tế', eduMajor: 'Quản Trị Kinh Doanh'
      }));
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      const profile = APP_DATA.employeeProfiles.find(p => p.employeeCode === r.json.item.employeeCode);
      assert.strictEqual(profile.education.length, 1);
      assert.strictEqual(profile.education[0].degree, 'Đại học');
      assert.strictEqual(profile.education[0].school, 'ĐH Kinh Tế');
      assert.strictEqual(profile.education[0].major, 'Quản Trị Kinh Doanh');
    });

    await test('chỉ nhập Chuyên ngành (thiếu Trình độ/Trường) -> 400 rõ ràng, KHÔNG tạo gì', async () => {
      resetAppData(); resetStore();
      const r = await call('POST', '/api/create/hrProcesses', onboardingPayload({ eduMajor: 'Kế Toán' }));
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
      assert.ok(/Trình độ.*Trường|Trường.*Trình độ/.test(r.json.error), `Thông điệp lỗi phải nêu rõ thiếu gì: ${r.json.error}`);
      assert.strictEqual(STORE.hrProcesses.length, 0);
    });

    await test('không nhập gì ở học vấn -> education[] rỗng, không lỗi', async () => {
      resetAppData(); resetStore();
      const r = await call('POST', '/api/create/hrProcesses', onboardingPayload({}));
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      const profile = APP_DATA.employeeProfiles.find(p => p.employeeCode === r.json.item.employeeCode);
      assert.strictEqual(profile.education.length, 0);
    });

    console.log('\n== 3) Loại HĐLĐ/Thời gian/Thu nhập DỰ KIẾN — CHỈ lưu tham khảo trên hrProcesses ==');

    await test('nhập đủ plannedContractType/plannedContractEndDate/plannedBaseSalary/1 khoản phụ cấp -> lưu đúng trên hrProcesses, KHÔNG đụng employeeProfiles', async () => {
      resetAppData(); resetStore();
      const r = await call('POST', '/api/create/hrProcesses', onboardingPayload({
        plannedContractType: 'PROBATION', plannedContractEndDate: '2027-01-02',
        plannedBaseSalary: '8000000', plannedAllowances: { transportAllowance: '300000' }
      }));
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.plannedContractType, 'PROBATION');
      assert.strictEqual(r.json.item.plannedContractEndDate, '2027-01-02');
      assert.strictEqual(r.json.item.plannedBaseSalary, 8000000);
      assert.strictEqual(r.json.item.plannedAllowances.transportAllowance, 300000);
      assert.strictEqual(r.json.item.plannedAllowances.lunchAllowance, null, 'Khoản không nhập phải là null, không phải 0/undefined');
      const profile = APP_DATA.employeeProfiles.find(p => p.employeeCode === r.json.item.employeeCode);
      assert.strictEqual('plannedContractType' in profile, false, 'employeeProfiles KHÔNG được có field HĐLĐ (đúng phạm vi: chỉ hrProcesses tham khảo)');
    });

    await test('plannedContractType=INDEFINITE kèm plannedContractEndDate -> tự XOÁ ngày kết thúc (không xác định thời hạn thì không có ngày kết thúc)', async () => {
      resetAppData(); resetStore();
      const r = await call('POST', '/api/create/hrProcesses', onboardingPayload({
        plannedContractType: 'INDEFINITE', plannedContractEndDate: '2099-01-01'
      }));
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.plannedContractEndDate, '');
    });

    await test('plannedContractType không hợp lệ -> 400', async () => {
      resetAppData(); resetStore();
      const r = await call('POST', '/api/create/hrProcesses', onboardingPayload({ plannedContractType: 'FOO' }));
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
    });

    await test('plannedBaseSalary âm -> 400', async () => {
      resetAppData(); resetStore();
      const r = await call('POST', '/api/create/hrProcesses', onboardingPayload({ plannedBaseSalary: '-100' }));
      assert.strictEqual(r.status, 400, JSON.stringify(r.json));
    });

    await test('để trống toàn bộ thu nhập dự kiến -> plannedBaseSalary/mọi khoản phụ cấp đều null, đủ cả 7 khoá ALLOWANCE_FIELDS', async () => {
      resetAppData(); resetStore();
      const r = await call('POST', '/api/create/hrProcesses', onboardingPayload({}));
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.strictEqual(r.json.item.plannedBaseSalary, null);
      for (const f of ALLOWANCE_FIELDS) assert.strictEqual(r.json.item.plannedAllowances[f], null, `${f} phải null`);
    });

    console.log('\n== 4) Đối chiếu danh mục dùng chung (không tự phát minh field thu nhập mới) ==');

    await test('CONTRACT_TYPES/ALLOWANCE_FIELDS dùng ĐÚNG y hệt Hợp Đồng Lao Động (không lệch nhau)', () => {
      assert.deepStrictEqual([...CONTRACT_TYPES].sort(), ['FIXED_TERM', 'INDEFINITE', 'PROBATION'].sort());
      assert.strictEqual(ALLOWANCE_FIELDS.length, 7);
    });
  } finally {
    server.close();
  }

  console.log('\n== 5) employmentType — lối tạo trực tiếp "Quản Lý Hồ Sơ > + Tạo Hồ Sơ Mới" (createManualProfile, unit) ==');

  await test('EMPLOYMENT_TYPES/WORK_SCHEDULES export đủ danh sách mặc định (giá trị FALLBACK khi caller không truyền catalogs qua options)', () => {
    assert.deepStrictEqual([...employeeProfile.EMPLOYMENT_TYPES].sort(),
      ['Bán thời gian', 'Chính thức', 'Cộng tác viên', 'Thời vụ'].sort());
    assert.deepStrictEqual([...employeeProfile.WORK_SCHEDULES].sort(),
      ['Ca chiều', 'Ca sáng', 'Ca tối', 'Giờ hành chính', 'Theo ca xoay'].sort());
  });

  await test('createManualProfile(): nhận employmentType/workSchedule + nationalIdIssueDate/nationalIdIssuePlace hợp lệ', () => {
    const list = [];
    const created = employeeProfile.createManualProfile(list, {
      employeeCode: 'BL9001', employmentType: 'Cộng tác viên', workSchedule: 'Ca sáng',
      nationalIdIssueDate: '2020-01-01', nationalIdIssuePlace: 'CA TP.HCM'
    }, 'admin', 'Quản Trị');
    assert.strictEqual(created.employmentType, 'Cộng tác viên');
    assert.strictEqual(created.workSchedule, 'Ca sáng');
    assert.strictEqual(created.nationalIdIssueDate, '2020-01-01');
    assert.strictEqual(created.nationalIdIssuePlace, 'CA TP.HCM');
  });

  await test('createManualProfile(): truyền options.employmentTypes/workSchedules -> đối chiếu ĐÚNG danh mục truyền vào (không rơi về fallback mặc định)', () => {
    const list = [];
    const created = employeeProfile.createManualProfile(list, {
      employeeCode: 'BL9001B', employmentType: 'Thực tập sinh', workSchedule: 'Làm từ xa'
    }, 'admin', 'Quản Trị', { employmentTypes: ['Thực tập sinh'], workSchedules: ['Làm từ xa'] });
    assert.strictEqual(created.employmentType, 'Thực tập sinh');
    assert.strictEqual(created.workSchedule, 'Làm từ xa');
    assert.throws(() => employeeProfile.createManualProfile(list, {
      employeeCode: 'BL9001C', employmentType: 'Chính thức'
    }, 'admin', 'Quản Trị', { employmentTypes: ['Thực tập sinh'] }), /Hình thức làm việc không hợp lệ/);
  });

  await test('createManualProfile(): workSchedule KHÔNG hợp lệ -> 400', () => {
    const list = [];
    assert.throws(() => employeeProfile.createManualProfile(list, {
      employeeCode: 'BL9002B', workSchedule: 'Ca đêm khuya (không có trong danh mục)'
    }, 'admin', 'Quản Trị'), /Thời gian làm việc không hợp lệ/);
  });

  await test('createManualProfile(): employmentType KHÔNG hợp lệ -> 400', () => {
    const list = [];
    assert.throws(() => employeeProfile.createManualProfile(list, {
      employeeCode: 'BL9002', employmentType: 'Thực tập sinh (không có trong danh mục)'
    }, 'admin', 'Quản Trị'), /Hình thức làm việc không hợp lệ/);
  });

  await test('HR_ONLY_EDITABLE_FIELDS chứa employmentType/workSchedule (PATCH /by-code sửa được 2 field này)', () => {
    assert.ok(employeeProfile.HR_ONLY_EDITABLE_FIELDS.includes('employmentType'));
    assert.ok(employeeProfile.HR_ONLY_EDITABLE_FIELDS.includes('workSchedule'));
  });

  // Nhắc lại (KHÔNG lặp test, chỉ xác nhận còn nguyên): logic chặn trùng Mã Nhân Viên khi nhập tay (không
  // phải Tái Tuyển) đã có đầy đủ từ trước — createManualProfile() luôn throw nếu employeeCode đã tồn tại
  // trong danh sách (mọi trạng thái), xem test-hr-profile.js/test-audit-nhansu-onboarding-contract.js #1.
  await test('createManualProfile(): Mã Nhân Viên trùng với hồ sơ đã có (bất kỳ trạng thái) -> chặn, hướng dẫn vào "Chi tiết" để sửa', () => {
    const list = [employeeProfile.defaultProfile('BL9003')];
    assert.throws(() => employeeProfile.createManualProfile(list, { employeeCode: 'BL9003' }, 'admin', 'Quản Trị'),
      /đã có hồ sơ/);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
