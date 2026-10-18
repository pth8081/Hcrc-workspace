// server/tests/test-onboarding-nationalid-race.js
//
// Regression test cho race condition ĐÃ VÁ (re-audit lần 4, mức Cao): assertNationalIdNotDuplicated()
// (gọi trong extraValidate của CREATE_MODULE_CONFIGS.hrProcesses, lib/createValidation.js) trước đây so
// khớp trên `appData.employeeProfiles` — 1 SNAPSHOT đọc đúng 1 LẦN ở ĐẦU request (routes/create.js,
// TRƯỚC khi vào lib/hrProcessOnboardingCreate.js::createOnboardingProcessRecord()), không bao giờ được
// làm mới. 2 quy trình Onboarding cho 2 ứng viên KHÁC employeeCode nhưng CÙNG 1 số CCCD/CMND, gửi gần
// như đồng thời, đều đọc được appData.employeeProfiles "chưa ai trùng CCCD" TRƯỚC khi bên nào kịp GHI
// CCCD của mình xong (việc ghi CCCD vào employeeProfiles chỉ xảy ra SAU KHI hrProcesses đã tạo xong, ở
// 1 khối withLockedAppDataValue('employeeProfiles', ...) TÁCH BIỆT khỏi bước kiểm tra) — cả 2 đều qua
// được chặn trùng, phá vỡ bất biến "1 CCCD = 1 nhân viên".
//
// Đã vá: gộp bước sinh/dành Mã Nhân Viên + kiểm tra trùng CCCD (bằng dữ liệu FRESH đọc ngay trong khoá)
// + tạo hrProcesses + ghi CCCD sau khi tạo thành MỘT khối withLockedAppDataValue('employeeProfiles', ...)
// DUY NHẤT — mirror đúng khuôn đã đúng từ trước ở createManualProfile() (routes/employeeProfile.js).
//
// Test này gọi thẳng router THẬT (routes/create.js) với lib/recordStore/lib/appData giả lập bằng hàng
// đợi mutex THẬT theo từng key (mirror khuôn test-operation-order-po-race.js) + yield giữa lúc lấy
// snapshot appData và lúc bắt đầu xử lý, để buộc 2 request bắn GẦN NHƯ ĐỒNG THỜI (Promise.all) phải
// thực sự tranh chấp cùng 1 cửa sổ thời gian — nếu bản vá bị hoàn tác, test này sẽ FAIL (phát hiện 2 hồ
// sơ nhân sự cùng trỏ 1 số CCCD).
//
// Chạy: node server/tests/test-onboarding-nationalid-race.js
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

const HR1 = { username: 'hr1', name: 'Nhân Sự 1', dept: 'Nhân Sự', perms: { hrOnboardingManage: true }, active: true };
const HR2 = { username: 'hr2', name: 'Nhân Sự 2', dept: 'Nhân Sự', perms: { hrOnboardingManage: true }, active: true };
// HR3 (re-audit lần 5, #145): CÙNG hrOnboardingManage như HR1/HR2 nhưng CÓ THÊM hrProfileEdit — đúng
// tier được phép xem chi tiết hồ sơ INACTIVE trùng CCCD (mirror requireProfileCreateOrEdit).
const HR3 = { username: 'hr3', name: 'Nhân Sự 3 (có hrProfileEdit)', dept: 'Nhân Sự', perms: { hrOnboardingManage: true, hrProfileEdit: true }, active: true };
const USERS = [HR1, HR2, HR3];

let APP_DATA_STORE = {};
function resetAppData() {
  APP_DATA_STORE = {
    users: USERS,
    depts: ['Nhân Sự', 'Kinh Doanh'],
    stores: [],
    jobTitles: ['Nhân Viên'],
    storeJobTitles: [],
    hrTaskTemplates: [],
    formTemplates: {},
    employeeProfiles: []
  };
}
resetAppData();

// ===== Hàng đợi mutex THẬT theo lockKey (mirror withFakeAppLock() ở test-operation-order-po-race.js) =====
const lockChains = new Map();
async function withFakeLock(lockKey, fn) {
  const prev = lockChains.get(lockKey) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  lockChains.set(lockKey, prev.then(() => current));
  await prev;
  try { return await fn(); } finally { release(); }
}
const DELAY_MS = 20;
function yieldTurn() { return new Promise((resolve) => setTimeout(resolve, DELAY_MS)); }

stubModule('lib/appData', {
  // Mỗi lần gọi mô phỏng đúng 1 lượt đọc SNAPSHOT JSON thật từ DB (JSON.parse(JSON.stringify(...))) —
  // KHÔNG trả về tham chiếu sống, và CHỜ 1 nhịp (yieldTurn) SAU khi chụp xong rồi mới trả về, để 2
  // request gọi getAllAppData() gần như đồng thời đều kịp "chốt" snapshot của mình TRƯỚC khi request nào
  // bắt đầu xử lý tiếp — đúng kịch bản khai thác thật (cả 2 đọc được "chưa ai trùng CCCD" cùng lúc).
  getAllAppData: async () => {
    const snapshot = JSON.parse(JSON.stringify(APP_DATA_STORE));
    await yieldTurn();
    return snapshot;
  },
  getAppDataValue: async (key) => JSON.parse(JSON.stringify(APP_DATA_STORE[key])),
  // withLockedAppDataValue THẬT: khoá theo key, ĐỌC FRESH currentValue NGAY TRONG khoá (mirror đúng
  // UPDLOCK/HOLDLOCK thật ở lib/appData.js) — đây CHÍNH LÀ cơ chế bản vá dựa vào để luôn thấy dữ liệu
  // mới nhất.
  withLockedAppDataValue: (key, fn) => withFakeLock(`appdata:${key}`, async () => {
    const currentValue = JSON.parse(JSON.stringify(APP_DATA_STORE[key]));
    const newValue = await fn(currentValue);
    APP_DATA_STORE[key] = newValue;
    return newValue;
  })
});

let RECORDS = { hrProcesses: [] };
let nextId = 1;
function resetRecords() { RECORDS = { hrProcesses: [] }; nextId = 1; }

stubModule('lib/recordStore', {
  MIGRATED_COLLECTIONS: new Set(['hrProcesses']),
  getAllForCollection: async (c) => (RECORDS[c] || []).slice(),
  getTrashItems: async () => [],
  createForCollection: async (c, builderFn) => {
    const draft = await builderFn((RECORDS[c] || []).slice());
    const record = Object.assign({ id: nextId++ }, draft);
    RECORDS[c] = RECORDS[c] || []; RECORDS[c].push(record);
    return record;
  },
  createForCollectionSerialized: async (c, lockKey, builderFn) => withFakeLock(`record:${lockKey}`, async () => {
    const draft = await builderFn((RECORDS[c] || []).slice());
    const record = Object.assign({ id: nextId++ }, draft);
    RECORDS[c] = RECORDS[c] || []; RECORDS[c].push(record);
    return record;
  }),
  withAppLock: async (key, fn) => withFakeLock(`applock:${key}`, fn)
});

stubModule('lib/uploadedFiles', { assertPayloadFileUrlsOwnedByUser: async () => {} });
stubModule('lib/systemLogStore', { insertSystemLog: async () => {}, querySystemLogs: async () => ({ items: [], total: 0 }) });

stubModule('lib/auth', {
  requireAuth: (req, res, next) => {
    const username = req.headers['x-test-user'];
    const fresh = USERS.find((u) => u.username === username);
    if (!fresh) return res.status(401).json({ error: 'Chưa đăng nhập' });
    req.user = { username: fresh.username, name: fresh.name };
    req.freshUser = fresh;
    req.allUsers = USERS;
    next();
  },
  blockIfMustChangePassword: (req, res, next) => next()
});

const express = require('express');
const createRoutes = require('../routes/create');

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/create', createRoutes);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function api(server, body, asUser) {
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/create/hrProcesses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-user': asUser.username },
    body: JSON.stringify(body)
  });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, body: payload };
}

function onboardingPayload(overrides) {
  return Object.assign({
    processType: 'ONBOARDING',
    fullName: 'Ứng Viên Race',
    employeePosType: 'HO',
    employeeDept: 'Kinh Doanh',
    employeeJobTitle: 'Nhân Viên',
    email: 'race@congty.vn',
    phone: '0900000000',
    startDate: '2026-12-01'
  }, overrides || {});
}

async function main() {
  const server = await startApp();
  try {
    resetAppData(); resetRecords();

    // Bắn GẦN NHƯ ĐỒNG THỜI: 2 nhân viên HR khác nhau cùng tạo Onboarding cho 2 ỨNG VIÊN KHÁC NHAU
    // (employeeCode tự sinh, chắc chắn khác nhau) nhưng CÙNG 1 số CCCD/CMND.
    const [r1, r2] = await Promise.all([
      api(server, onboardingPayload({ fullName: 'Ứng Viên A', nationalId: '079099001234' }), HR1),
      api(server, onboardingPayload({ fullName: 'Ứng Viên B', nationalId: '079099001234' }), HR2)
    ]);

    const withThisNationalId = (APP_DATA_STORE.employeeProfiles || []).filter(p => p.nationalId === '079099001234');

    check('KHÔNG được tạo 2 hồ sơ nhân sự cùng trỏ 1 số CCCD/CMND (LỖI ĐÃ VÁ — race condition)',
      withThisNationalId.length === 1,
      { r1Status: r1.status, r2Status: r2.status, withThisNationalId });

    const bothSucceeded = r1.status === 200 && r2.status === 200;
    check('KHÔNG được cả 2 request tạo Onboarding cùng thành công (loại trừ nhau)',
      !bothSucceeded, { r1Status: r1.status, r2Status: r2.status });

    const failed = r1.status === 200 ? r2 : r1;
    check('Request thua cuộc phải bị chặn 409 với đúng lý do "CCCD/CMND ... đã tồn tại"',
      failed.status === 409 && /CCCD\/CMND/.test(failed.body?.error || ''),
      failed.body);

    check('Request thắng cuộc phải tạo thành công 1 hrProcesses + 1 employeeProfiles DRAFT',
      RECORDS.hrProcesses.length === 1 && (APP_DATA_STORE.employeeProfiles || []).length === 1,
      { hrProcessesCount: RECORDS.hrProcesses.length, profilesCount: (APP_DATA_STORE.employeeProfiles || []).length });

    // Kiểm chứng thêm: 2 Onboarding KHÁC CCCD (không tranh chấp gì) vẫn tạo song song bình thường, không
    // bị khoá chung "vô tình" chặn nhầm 2 request không liên quan tới nhau.
    resetAppData(); resetRecords();
    const [r3, r4] = await Promise.all([
      api(server, onboardingPayload({ fullName: 'Ứng Viên C', nationalId: '079099005555' }), HR1),
      api(server, onboardingPayload({ fullName: 'Ứng Viên D', nationalId: '079099006666' }), HR2)
    ]);
    check('2 Onboarding KHÁC CCCD vẫn tạo đồng thời bình thường (không bị khoá chung chặn nhầm)',
      r3.status === 200 && r4.status === 200 && RECORDS.hrProcesses.length === 2,
      { r3Status: r3.status, r4Status: r4.status, count: RECORDS.hrProcesses.length });

    // Kiểm chứng thêm: để trống CCCD (tuỳ chọn) vẫn tạo được bình thường, không bị khoá chung chặn nhầm
    // (nhánh "không có gì cần chống trùng" trong getLockKey/kiểm tra fresh vẫn phải cho qua).
    resetAppData(); resetRecords();
    const [r5, r6] = await Promise.all([
      api(server, onboardingPayload({ fullName: 'Ứng Viên E' }), HR1),
      api(server, onboardingPayload({ fullName: 'Ứng Viên F' }), HR2)
    ]);
    check('2 Onboarding ĐỀU không nhập CCCD vẫn tạo đồng thời bình thường',
      r5.status === 200 && r6.status === 200 && RECORDS.hrProcesses.length === 2,
      { r5Status: r5.status, r6Status: r6.status, count: RECORDS.hrProcesses.length });

    // ===== LỖI ĐÃ VÁ (re-audit lần 5, mức Thấp — "Tạo Onboarding lộ mã NV đã nghỉ việc qua CCCD"):
    // assertNationalIdNotDuplicated() CHỦ Ý luôn lộ employeeCode + "ĐÃ NGHỈ VIỆC" cho hồ sơ INACTIVE
    // trùng CCCD BẤT KỂ canViewFull — an toàn ở 2 nơi gọi gốc (route gác đúng tier hrProfileCreate/Edit/
    // Manage), nhưng route tạo Onboarding chỉ gác canCreateHrProcess() (hrOnboardingManage), KHÔNG đòi
    // tier đó. HR1 (CHỈ hrOnboardingManage) dò CCCD của 1 nhân viên CŨ (INACTIVE) không được thấy
    // employeeCode/trạng thái; HR3 (hrOnboardingManage + hrProfileEdit) thì được (đúng tier). =====
    resetAppData(); resetRecords();
    APP_DATA_STORE.employeeProfiles.push({
      employeeCode: 'NV999', nationalId: '079099009999', status: 'INACTIVE', fullName: 'Người Đã Nghỉ'
    });
    const rInactiveLeak = await api(server, onboardingPayload({ fullName: 'Ứng Viên G', nationalId: '079099009999' }), HR1);
    check('LỖI ĐÃ VÁ: HR1 (CHỈ hrOnboardingManage) dò CCCD trùng hồ sơ INACTIVE -> 409 KHÔNG lộ employeeCode/trạng thái nghỉ việc',
      rInactiveLeak.status === 409 && !/NV999/.test(rInactiveLeak.body?.error || '') && !/NGHỈ VIỆC/.test(rInactiveLeak.body?.error || ''),
      rInactiveLeak.body);

    resetAppData(); resetRecords();
    APP_DATA_STORE.employeeProfiles.push({
      employeeCode: 'NV999', nationalId: '079099009999', status: 'INACTIVE', fullName: 'Người Đã Nghỉ'
    });
    const rInactiveDetail = await api(server, onboardingPayload({ fullName: 'Ứng Viên H', nationalId: '079099009999' }), HR3);
    check('đối chứng: HR3 (có thêm hrProfileEdit, đúng tier "Kiểm Tra Nhân Sự Cũ") vẫn thấy ĐÚNG chi tiết employeeCode/trạng thái (không mất chức năng đã có)',
      rInactiveDetail.status === 409 && /NV999/.test(rInactiveDetail.body?.error || '') && /NGHỈ VIỆC/.test(rInactiveDetail.body?.error || ''),
      rInactiveDetail.body);

    // ===== LỖI ĐÃ VÁ (re-audit lần 7, mức Cao — "hrOnboardingManage đọc/ghi hồ sơ INACTIVE qua đường
    // onboarding queue"): tái tuyển (employeeCode trỏ hồ sơ INACTIVE) trước đây KHÔNG đối chiếu danh tính
    // gì — HR1 (CHỈ hrOnboardingManage, không có bất kỳ quyền Hồ Sơ Nhân Sự nào) tự gửi employeeCode của
    // 1 người đã nghỉ việc BẤT KỲ (biết/đoán được, mã dạng tuần tự) + CCCD/Ngày sinh KHÔNG khớp hồ sơ đó
    // -> vẫn "tái tuyển" được, mở khoá PATCH /by-code đọc/ghi hồ sơ CŨ không liên quan. Nay bắt buộc
    // CCCD HOẶC Ngày sinh (payload) phải khớp ĐÚNG hồ sơ INACTIVE đó. =====
    resetAppData(); resetRecords();
    APP_DATA_STORE.employeeProfiles.push({
      employeeCode: 'NV777', nationalId: '079099007777', dateOfBirth: '1990-05-20', status: 'INACTIVE', fullName: 'Người Cũ 777'
    });
    const rHijackNoMatch = await api(server, onboardingPayload({
      fullName: 'Kẻ Tấn Công Mạo Danh', employeeCode: 'NV777', nationalId: '079099999999', dateOfBirth: '2000-01-01'
    }), HR1);
    check('LỖI ĐÃ VÁ: tái tuyển bằng employeeCode của hồ sơ INACTIVE nhưng CCCD/Ngày sinh KHÔNG khớp -> 403, không cho tái tuyển',
      rHijackNoMatch.status === 403 && /không khớp/.test(rHijackNoMatch.body?.error || ''),
      rHijackNoMatch.body);
    check('LỖI ĐÃ VÁ: request bị chặn ở trên không được tạo hrProcesses/đổi gì trên hồ sơ NV777',
      RECORDS.hrProcesses.length === 0 && APP_DATA_STORE.employeeProfiles.find(p => p.employeeCode === 'NV777')?.status === 'INACTIVE',
      { hrProcesses: RECORDS.hrProcesses, profile: APP_DATA_STORE.employeeProfiles.find(p => p.employeeCode === 'NV777') });

    resetAppData(); resetRecords();
    APP_DATA_STORE.employeeProfiles.push({
      employeeCode: 'NV778', nationalId: '079099007778', dateOfBirth: '1991-06-21', status: 'INACTIVE', fullName: 'Người Cũ 778'
    });
    const rHijackNoIdentityAtAll = await api(server, onboardingPayload({
      fullName: 'Kẻ Tấn Công Không Gửi Gì', employeeCode: 'NV778'
    }), HR1);
    check('LỖI ĐÃ VÁ: tái tuyển bằng employeeCode của hồ sơ INACTIVE, KHÔNG gửi CCCD/Ngày sinh gì cả -> 403',
      rHijackNoIdentityAtAll.status === 403 && /không khớp/.test(rHijackNoIdentityAtAll.body?.error || ''),
      rHijackNoIdentityAtAll.body);

    resetAppData(); resetRecords();
    APP_DATA_STORE.employeeProfiles.push({
      employeeCode: 'NV779', nationalId: '079099007779', dateOfBirth: '1992-07-22', status: 'INACTIVE', fullName: 'Người Cũ 779'
    });
    const rRehireNidMatch = await api(server, onboardingPayload({
      fullName: 'Người Cũ 779 Tái Tuyển', employeeCode: 'NV779', nationalId: '079099007779', dateOfBirth: '2000-01-01'
    }), HR1);
    check('đối chứng: CCCD khớp (dù Ngày sinh KHÔNG khớp) -> vẫn tái tuyển được bình thường (không chặn oan)',
      rRehireNidMatch.status === 200, rRehireNidMatch.body);

    resetAppData(); resetRecords();
    APP_DATA_STORE.employeeProfiles.push({
      employeeCode: 'NV780', nationalId: '079099007780', dateOfBirth: '1993-08-23', status: 'INACTIVE', fullName: 'Người Cũ 780'
    });
    const rRehireDobMatch = await api(server, onboardingPayload({
      fullName: 'Người Cũ 780 Tái Tuyển', employeeCode: 'NV780', nationalId: '079099999999', dateOfBirth: '1993-08-23'
    }), HR1);
    check('đối chứng: Ngày sinh khớp (dù CCCD KHÔNG khớp) -> vẫn tái tuyển được bình thường (không chặn oan)',
      rRehireDobMatch.status === 200, rRehireDobMatch.body);
  } finally {
    server.close();
  }

  console.log(`\n==== ${pass}/${pass + fail} scenario(s) passed ====`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
