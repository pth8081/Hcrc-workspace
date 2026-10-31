// tests/test-shelf-kehang-phase2.js — "📋 Kiểm Soát Hàng Hóa", bổ sung sau Phase 1 MVP (11/2026),
// THIẾT KẾ LẠI 11/2026 (xem khối shelfStockThresholds ở lib/createValidation.js): Phần A (Sửa/Ngừng
// dùng Quầy Kệ) + Phần B (Ngưỡng Tồn model mới — maHang/maVach/category 1-trong-3 + 4 tầng người nhận +
// nhiều điều kiện cảnh báo độc lập). Test TRỰC TIẾP logic server (lib/shelfStockEdit.js,
// lib/createValidation.js, lib/recordViewScope.js) + job jobs/shelfStockThresholdAlert.js (db/mailer
// giả, cùng khuôn tests/test-hr-task-overdue-reminder.js).
'use strict';
const path = require('path');
const { createRunner, assert, assertEqual } = require('./testHarness');
const { CREATE_MODULE_CONFIGS, CreateError, validateAndPrepareCreate } = require('../lib/createValidation');
const { applyShelfLocationEdit, applyShelfStockThresholdEdit } = require('../lib/shelfStockEdit');
const { canViewShelfStockThreshold, filterShelfStockThresholdsForUser, MODULE_ACCESS_GATED_COLLECTIONS } = require('../lib/recordViewScope');
const { HttpError } = require('../lib/httpErrors');

function userOf(dept, perms) {
  return { username: 'u1', name: 'User 1', dept, perms: perms || {} };
}
function todayIso() { return new Date().toISOString(); }

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}

async function main() {
  const run = createRunner();

  // ===== Phần A: Sửa Quầy Kệ (lib/shelfStockEdit.js) — KHÔNG đổi so với Phase 1 =====
  await run.run('applyShelfLocationEdit: thiếu quyền -> HttpError 403', async () => {
    const item = { id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Cũ', active: true };
    let caught = null;
    try { applyShelfLocationEdit(item, { name: 'Mới' }, userOf('Siêu thị Quận 1', {})); }
    catch (err) { caught = err; }
    assert(caught instanceof HttpError && caught.status === 403, `phải 403, thực tế: ${caught}`);
  });

  await run.run('applyShelfLocationEdit: siêu thị khác (không admin) -> HttpError 403', async () => {
    const item = { id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Cũ', active: true };
    let caught = null;
    try { applyShelfLocationEdit(item, { name: 'Mới' }, userOf('Siêu thị Quận 7', { shelfLocationManage: true })); }
    catch (err) { caught = err; }
    assert(caught instanceof HttpError && caught.status === 403, `phải 403, thực tế: ${caught}`);
  });

  await run.run('applyShelfLocationEdit: đúng siêu thị -> sửa OK, code/dept KHÔNG đổi dù client gửi lên', async () => {
    const item = { id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Cũ', category: 'Cũ', active: true };
    const next = applyShelfLocationEdit(item, { name: 'Mới', category: 'NganhHangMoi', active: false, code: 'HACK', dept: 'Siêu thị Quận 7' }, userOf('Siêu thị Quận 1', { shelfLocationManage: true }));
    assertEqual(next.name, 'Mới', 'name phải đổi');
    assertEqual(next.category, 'NganhHangMoi', 'category phải đổi');
    assertEqual(next.active, false, 'active phải đổi thành false (Ngừng dùng)');
    assertEqual(next.code, 'A1', 'code KHÔNG được đổi dù client gửi "HACK"');
    assertEqual(next.dept, 'Siêu thị Quận 1', 'dept KHÔNG được đổi dù client gửi siêu thị khác');
  });

  await run.run('applyShelfLocationEdit: admin sửa được siêu thị khác', async () => {
    const item = { id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Cũ', active: true };
    const next = applyShelfLocationEdit(item, { name: 'Admin sửa' }, userOf('HO', { admin: true }));
    assertEqual(next.name, 'Admin sửa', 'admin phải sửa được');
  });

  await run.run('applyShelfLocationEdit: sửa tên rỗng -> HttpError 400', async () => {
    const item = { id: 1, dept: 'Siêu thị Quận 1', code: 'A1', name: 'Cũ', active: true };
    let caught = null;
    try { applyShelfLocationEdit(item, { name: '  ' }, userOf('Siêu thị Quận 1', { shelfLocationManage: true })); }
    catch (err) { caught = err; }
    assert(caught instanceof HttpError && caught.status === 400, `phải 400, thực tế: ${caught}`);
  });

  // ===== Phần B: Tạo Ngưỡng Tồn (lib/createValidation.js, CREATE_MODULE_CONFIGS.shelfStockThresholds)
  // — model mới: maHang/maVach/category (ít nhất 1 trong 3) + extraRecipientUsernames (Tầng 4, validate
  // theo appData.users) =====
  await run.run('shelfStockThresholds: thiếu quyền -> CreateError 403', async () => {
    let caught = null;
    try {
      validateAndPrepareCreate('shelfStockThresholds', { category: 'Đồ uống', minQuantity: 10 }, userOf('Siêu thị Quận 1', {}), [], {});
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 403, `phải 403, thực tế: ${caught}`);
  });

  await run.run('shelfStockThresholds: thiếu cả 3 trường nhận diện -> CreateError 400', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfLocationManage: true });
    let caught = null;
    try {
      validateAndPrepareCreate('shelfStockThresholds', { minQuantity: 10 }, user, [], {});
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 400, `phải 400, thực tế: ${caught}`);
  });

  await run.run('shelfStockThresholds: chỉ cần 1 trong 3 (maHang) là đủ, maVach/category để trống vẫn OK', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfLocationManage: true });
    const record = validateAndPrepareCreate('shelfStockThresholds', { maHang: '2003330491', minQuantity: 10 }, user, [], {});
    assertEqual(record.maHang, '2003330491');
    assertEqual(record.maVach, '');
    assertEqual(record.category, '');
  });

  await run.run('shelfStockThresholds: ngưỡng âm -> CreateError 400', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfLocationManage: true });
    let caught = null;
    try {
      validateAndPrepareCreate('shelfStockThresholds', { maHang: 'SKU001', minQuantity: -5 }, user, [], {});
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 400, `phải 400, thực tế: ${caught}`);
  });

  await run.run('shelfStockThresholds: extraRecipientUsernames username lạ/siêu thị khác -> CreateError 400', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfLocationManage: true });
    const appData = { users: [
      { username: 'cht1', dept: 'Siêu thị Quận 1', active: true },
      { username: 'cht7', dept: 'Siêu thị Quận 7', active: true },
      { username: 'cht1_inactive', dept: 'Siêu thị Quận 1', active: false }
    ] };
    let caught = null;
    try {
      validateAndPrepareCreate('shelfStockThresholds', { maHang: 'SKU001', minQuantity: 10, extraRecipientUsernames: ['cht7'] }, user, [], appData);
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 400, `username siêu thị khác phải bị chặn, thực tế: ${caught}`);

    caught = null;
    try {
      validateAndPrepareCreate('shelfStockThresholds', { maHang: 'SKU001', minQuantity: 10, extraRecipientUsernames: ['cht1_inactive'] }, user, [], appData);
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 400, `username inactive phải bị chặn, thực tế: ${caught}`);

    caught = null;
    try {
      validateAndPrepareCreate('shelfStockThresholds', { maHang: 'SKU001', minQuantity: 10, extraRecipientUsernames: ['khong_ton_tai'] }, user, [], appData);
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 400, `username không tồn tại phải bị chặn, thực tế: ${caught}`);

    const record = validateAndPrepareCreate('shelfStockThresholds', { maHang: 'SKU001', minQuantity: 10, extraRecipientUsernames: ['cht1', 'cht1'] }, user, [], appData);
    assertEqual(JSON.stringify(record.extraRecipientUsernames), JSON.stringify(['cht1']), 'username hợp lệ đúng siêu thị phải được chấp nhận + dedup');
  });

  await run.run('shelfStockThresholds: hợp lệ cả 3 trường -> tạo OK, dept LUÔN = user.dept (forceOwnDept)', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfLocationManage: true });
    const record = validateAndPrepareCreate('shelfStockThresholds', {
      maHang: '2003330491', maVach: '8934696001589', category: 'Đồ uống', minQuantity: 10, dept: 'Siêu thị Quận 7 (giả mạo)'
    }, user, [], {});
    assertEqual(record.dept, 'Siêu thị Quận 1', 'dept phải = user.dept');
    assertEqual(record.maHang, '2003330491');
    assertEqual(record.maVach, '8934696001589');
    assertEqual(record.category, 'Đồ uống');
    assertEqual(record.minQuantity, 10);
    assertEqual(record.active, true);
  });

  await run.run('shelfStockThresholds: trùng tổ hợp maHang/maVach/category CHỈ chặn trong CÙNG siêu thị', async () => {
    const user1 = userOf('Siêu thị Quận 1', { shelfLocationManage: true });
    const user7 = userOf('Siêu thị Quận 7', { shelfLocationManage: true });
    const existing = [{ id: 1, dept: 'Siêu thị Quận 1', maHang: '', maVach: '', category: 'Đồ uống', active: true }];
    let caught = null;
    try {
      validateAndPrepareCreate('shelfStockThresholds', { category: 'Đồ uống', minQuantity: 5 }, user1, existing, {});
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 409, 'phải báo trùng trong CÙNG siêu thị');

    const record7 = validateAndPrepareCreate('shelfStockThresholds', { category: 'Đồ uống', minQuantity: 5 }, user7, existing, {});
    assertEqual(record7.dept, 'Siêu thị Quận 7', 'siêu thị khác vẫn tạo được ngưỡng cùng phạm vi');
  });

  // ===== Phần B: Sửa Ngưỡng Tồn (lib/shelfStockEdit.js) =====
  await run.run('applyShelfStockThresholdEdit: siêu thị khác -> HttpError 403, maHang/maVach/category bất biến', async () => {
    const item = { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU001', maVach: '', category: '', minQuantity: 10, extraRecipientUsernames: [], active: true };
    let caught = null;
    try { applyShelfStockThresholdEdit(item, { minQuantity: 20 }, userOf('Siêu thị Quận 7', { shelfLocationManage: true }), []); }
    catch (err) { caught = err; }
    assert(caught instanceof HttpError && caught.status === 403, `phải 403, thực tế: ${caught}`);

    const allUsers = [{ username: 'cht1', dept: 'Siêu thị Quận 1', active: true }];
    const next = applyShelfStockThresholdEdit(item, { minQuantity: 20, maHang: 'HACK', category: 'HACK', extraRecipientUsernames: ['cht1'], active: false }, userOf('Siêu thị Quận 1', { shelfLocationManage: true }), allUsers);
    assertEqual(next.minQuantity, 20);
    assertEqual(next.maHang, 'SKU001', 'maHang KHÔNG đổi dù client gửi "HACK" (không nằm trong field cho phép sửa)');
    assertEqual(JSON.stringify(next.extraRecipientUsernames), JSON.stringify(['cht1']));
    assertEqual(next.active, false);
  });

  await run.run('applyShelfStockThresholdEdit: extraRecipientUsernames username siêu thị khác -> HttpError 400', async () => {
    const item = { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU001', maVach: '', category: '', minQuantity: 10, active: true };
    const allUsers = [{ username: 'cht7', dept: 'Siêu thị Quận 7', active: true }];
    let caught = null;
    try { applyShelfStockThresholdEdit(item, { extraRecipientUsernames: ['cht7'] }, userOf('Siêu thị Quận 1', { shelfLocationManage: true }), allUsers); }
    catch (err) { caught = err; }
    assert(caught instanceof HttpError && caught.status === 400, `phải 400, thực tế: ${caught}`);
  });

  // ===== recordViewScope.js — KHÔNG đổi so với Phase 1 =====
  await run.run('MODULE_ACCESS_GATED_COLLECTIONS.vanHanh có shelfStockThresholds', async () => {
    assert(MODULE_ACCESS_GATED_COLLECTIONS.vanHanh.includes('shelfStockThresholds'), 'thiếu shelfStockThresholds');
  });
  await run.run('canViewShelfStockThreshold/filterShelfStockThresholdsForUser mirror shelfLocations', async () => {
    const items = [{ id: 1, dept: 'Siêu thị Quận 1' }, { id: 2, dept: 'Siêu thị Quận 7' }];
    const user1 = userOf('Siêu thị Quận 1', {});
    assertEqual(filterShelfStockThresholdsForUser(items, user1).length, 1, 'chỉ thấy đúng siêu thị mình');
    const userAll = userOf('Siêu thị Quận 1', { shelfReportView: { all: true, depts: [] } });
    assertEqual(filterShelfStockThresholdsForUser(items, userAll).length, 2, 'shelfReportView.all thấy tất cả');
    const userScoped = userOf('Phòng Vận Hành', { shelfReportView: { all: false, depts: ['Siêu thị Quận 7'] } });
    assertEqual(filterShelfStockThresholdsForUser(items, userScoped).length, 1, 'shelfReportView.depts chỉ thấy đúng siêu thị được gán');
  });

  // ===== jobs/shelfStockThresholdAlert.js (db/mailer giả, cùng khuôn test-hr-task-overdue-reminder.js)
  // — model mới: 4 tầng người nhận tự động/thủ công + nhiều điều kiện cảnh báo độc lập/ngưỡng =====
  const STORE = {
    shelfStockThresholds: [],
    shelfRecords: [],
    shelfLocations: [],
    users: []
  };
  const APP_DATA = {
    emailConfig: { enabled: true, smtpHost: 'smtp.test', smtpPort: 587, senderEmail: 'system@test.vn' }
  };
  stubModule('db', {
    getPool: async () => ({
      request: () => {
        let key = null;
        const req = {
          input: (name, type, value) => { key = value; return req; },
          query: async () => {
            const value = key === 'emailConfig' ? APP_DATA.emailConfig : STORE[key];
            return { recordset: value === undefined ? [] : [{ DataValue: JSON.stringify(value) }] };
          }
        };
        return req;
      }
    }),
    sql: { NVarChar: () => 'NVARCHAR' }
  });
  stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
  stubModule('lib/emailCrypto', { decryptSecret: (s) => s });
  stubModule('lib/emailTemplate', { buildNotificationEmailHtml: () => '<html></html>' });
  let sentMails = [];
  stubModule('lib/mailer', {
    sendMail: async ({ to, subject }) => { sentMails.push({ to, subject }); return { sent: to, failed: [], simulated: false }; },
    resolveEncryption: () => 'STARTTLS',
    resolveGraphOption: () => null,
    resolveEwsOption: () => null
  });
  const { checkShelfStockThresholdAlerts } = require('../jobs/shelfStockThresholdAlert');

  function baseUsers() {
    return [
      // Tầng 1: cửa hàng trưởng ĐÚNG siêu thị Quận 1.
      { username: 'cht1', name: 'Cửa Hàng Trưởng Q1', dept: 'Siêu thị Quận 1', active: true, email: 'cht1@hcrc.vn', perms: { shelfLocationManage: true } },
      // Tầng 1 nhưng siêu thị KHÁC -> không được tính cho ngưỡng của Quận 1.
      { username: 'cht7', name: 'Cửa Hàng Trưởng Q7', dept: 'Siêu thị Quận 7', active: true, email: 'cht7@hcrc.vn', perms: { shelfLocationManage: true } },
      // Tầng 2: quản lý vùng phụ trách Quận 1 (trong depts[]).
      { username: 'qlv1', name: 'Quản Lý Vùng 1', dept: 'Phòng Vận Hành', active: true, email: 'qlv1@hcrc.vn', perms: { shelfReportView: { all: false, depts: ['Siêu thị Quận 1'] } } },
      // Tầng 3: nhận toàn hệ thống.
      { username: 'bgd', name: 'Ban Giám Đốc', dept: 'HO', active: true, email: 'bgd@hcrc.vn', perms: { shelfReportView: { all: true, depts: [] } } },
      // Không thuộc tầng nào -> không nhận.
      { username: 'khac', name: 'Khác', dept: 'Phòng Mua Hàng', active: true, email: 'khac@hcrc.vn', perms: {} }
    ];
  }

  await run.run('job: SKU dưới ngưỡng -> gửi đúng 3 tầng tự động; SKU đủ ngưỡng -> không gửi; siêu thị khác không bị tính nhầm', async () => {
    sentMails = [];
    STORE.users = baseUsers();
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU001', maVach: '', category: '', minQuantity: 10, extraRecipientUsernames: [], active: true },
      { id: 2, dept: 'Siêu thị Quận 1', maHang: 'SKU002', maVach: '', category: '', minQuantity: 5, extraRecipientUsernames: [], active: true }
    ];
    STORE.shelfLocations = [{ id: 100, dept: 'Siêu thị Quận 1', code: 'A1', category: 'Đồ uống' }];
    STORE.shelfRecords = [
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU001', maVach: '', quantity: 3, createdAt: todayIso() },
      { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU002', maVach: '', quantity: 8, createdAt: todayIso() },
      // Siêu thị khác, cùng SKU001 — KHÔNG được cộng vào tổng của Siêu thị Quận 1.
      { id: 3, dept: 'Siêu thị Quận 7', shelfLocationId: 200, maHang: 'SKU001', maVach: '', quantity: 100, createdAt: todayIso() }
    ];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 1, `phải gửi đúng 1 email (SKU001 thiếu), thực tế: ${JSON.stringify(sentMails)}`);
    const got = [...sentMails[0].to].sort();
    assertEqual(JSON.stringify(got), JSON.stringify(['bgd@hcrc.vn', 'cht1@hcrc.vn', 'qlv1@hcrc.vn']), `phải đúng 3 tầng tự động (không có cht7/khac), thực tế: ${JSON.stringify(got)}`);
  });

  await run.run('job: maVach khớp đủ (không cần maHang khớp) vẫn tính vào tổng SKU', async () => {
    sentMails = [];
    STORE.users = baseUsers();
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', maHang: '', maVach: '8934696001589', category: '', minQuantity: 10, extraRecipientUsernames: [], active: true }
    ];
    STORE.shelfLocations = [{ id: 100, dept: 'Siêu thị Quận 1', code: 'A1', category: 'Đồ uống' }];
    STORE.shelfRecords = [
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: '', maVach: '8934696001589', quantity: 3, createdAt: todayIso() }
    ];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 1, 'khớp maVach (không cần maHang) vẫn phải tính vào tổng và cảnh báo');
  });

  await run.run('job: CATEGORY tra category qua shelfLocationId (shelfRecords không lưu category trực tiếp)', async () => {
    sentMails = [];
    STORE.users = baseUsers();
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', maHang: '', maVach: '', category: 'Đồ uống', minQuantity: 20, extraRecipientUsernames: [], active: true }
    ];
    STORE.shelfLocations = [
      { id: 100, dept: 'Siêu thị Quận 1', code: 'A1', category: 'Đồ uống' },
      { id: 101, dept: 'Siêu thị Quận 1', code: 'A2', category: 'Bánh kẹo' }
    ];
    STORE.shelfRecords = [
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'X1', maVach: '', quantity: 5, createdAt: todayIso() },
      { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 101, maHang: 'X2', maVach: '', quantity: 50, createdAt: todayIso() } // ngành hàng khác, không tính
    ];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 1, `tổng Đồ uống = 5 < 20 -> phải cảnh báo, thực tế: ${JSON.stringify(sentMails)}`);
  });

  await run.run('job: "nhập 1 là đủ, nhập nhiều thì check nhiều điều kiện" — cả SKU lẫn ngành hàng đều dưới ngưỡng -> bắn 2 email độc lập', async () => {
    sentMails = [];
    STORE.users = baseUsers();
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU001', maVach: '', category: 'Đồ uống', minQuantity: 10, extraRecipientUsernames: [], active: true }
    ];
    STORE.shelfLocations = [{ id: 100, dept: 'Siêu thị Quận 1', code: 'A1', category: 'Đồ uống' }];
    STORE.shelfRecords = [
      // SKU001 = 3 (< 10) VÀ tổng ngành "Đồ uống" cũng chỉ 3 (< 10) -> CẢ 2 điều kiện cùng vi phạm.
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU001', maVach: '', quantity: 3, createdAt: todayIso() }
    ];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 2, `phải bắn 2 email độc lập (1 SKU + 1 ngành hàng), thực tế: ${JSON.stringify(sentMails)}`);
  });

  await run.run('job: điền cả SKU lẫn ngành hàng nhưng CHỈ 1 điều kiện vi phạm -> chỉ 1 email', async () => {
    sentMails = [];
    STORE.users = baseUsers();
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU001', maVach: '', category: 'Đồ uống', minQuantity: 10, extraRecipientUsernames: [], active: true }
    ];
    STORE.shelfLocations = [
      { id: 100, dept: 'Siêu thị Quận 1', code: 'A1', category: 'Đồ uống' },
      { id: 101, dept: 'Siêu thị Quận 1', code: 'A2', category: 'Đồ uống' }
    ];
    STORE.shelfRecords = [
      // SKU001 = 3 (< 10, vi phạm). Ngành "Đồ uống" cộng thêm SKU khác tại quầy A2 = 3 + 20 = 23 (>= 10, đủ).
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU001', maVach: '', quantity: 3, createdAt: todayIso() },
      { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 101, maHang: 'SKU999', maVach: '', quantity: 20, createdAt: todayIso() }
    ];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 1, `chỉ điều kiện SKU vi phạm -> đúng 1 email, thực tế: ${JSON.stringify(sentMails)}`);
  });

  await run.run('job: Tầng 4 (extraRecipientUsernames) được cộng thêm vào danh sách tự động, dedup đúng', async () => {
    sentMails = [];
    const users = baseUsers();
    users.push({ username: 'extra1', name: 'Nhân Viên Thêm', dept: 'Siêu thị Quận 1', active: true, email: 'extra1@hcrc.vn', perms: {} });
    STORE.users = users;
    STORE.shelfStockThresholds = [
      // cht1 vừa thuộc Tầng 1 (tự động) vừa bị thêm lại ở Tầng 4 -> không gửi trùng.
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU001', maVach: '', category: '', minQuantity: 10, extraRecipientUsernames: ['extra1', 'cht1'], active: true }
    ];
    STORE.shelfLocations = [{ id: 100, dept: 'Siêu thị Quận 1', code: 'A1', category: 'Đồ uống' }];
    STORE.shelfRecords = [
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU001', maVach: '', quantity: 3, createdAt: todayIso() }
    ];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 1);
    const got = [...sentMails[0].to].sort();
    assertEqual(JSON.stringify(got), JSON.stringify(['bgd@hcrc.vn', 'cht1@hcrc.vn', 'extra1@hcrc.vn', 'qlv1@hcrc.vn']), `phải cộng thêm extra1, cht1 không trùng lặp, thực tế: ${JSON.stringify(got)}`);
  });

  await run.run('job: user đã tự tắt notifyEmailModules.SHELF_THRESHOLD=false -> bị loại khỏi người nhận', async () => {
    sentMails = [];
    const users = baseUsers();
    users[0].notifyEmailModules = { SHELF_THRESHOLD: false }; // cht1 tự tắt
    STORE.users = users;
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU001', maVach: '', category: '', minQuantity: 10, extraRecipientUsernames: [], active: true }
    ];
    STORE.shelfLocations = [{ id: 100, dept: 'Siêu thị Quận 1', code: 'A1', category: 'Đồ uống' }];
    STORE.shelfRecords = [
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU001', maVach: '', quantity: 3, createdAt: todayIso() }
    ];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 1);
    const got = [...sentMails[0].to].sort();
    assert(!got.includes('cht1@hcrc.vn'), `cht1 đã tắt nhận email, KHÔNG được có trong danh sách, thực tế: ${JSON.stringify(got)}`);
    assertEqual(JSON.stringify(got), JSON.stringify(['bgd@hcrc.vn', 'qlv1@hcrc.vn']));
  });

  await run.run('job: ngưỡng active=false -> bỏ qua hoàn toàn', async () => {
    sentMails = [];
    STORE.users = baseUsers();
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU999', maVach: '', category: '', minQuantity: 100, extraRecipientUsernames: [], active: false }
    ];
    STORE.shelfLocations = [];
    STORE.shelfRecords = [];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 0, 'ngưỡng ngừng dùng không được gửi email');
  });

  await run.run('job: không có ghi nhận hôm nay -> tổng = 0, LUÔN dưới ngưỡng -> cảnh báo', async () => {
    sentMails = [];
    STORE.users = baseUsers();
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU777', maVach: '', category: '', minQuantity: 1, extraRecipientUsernames: [], active: true }
    ];
    STORE.shelfLocations = [];
    STORE.shelfRecords = [];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 1, 'không có bản ghi hôm nay vẫn phải cảnh báo (tổng=0 < ngưỡng)');
  });

  run.summary();
}

main().catch(err => { console.error(err); process.exit(1); });
