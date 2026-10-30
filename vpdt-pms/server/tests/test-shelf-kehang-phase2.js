// tests/test-shelf-kehang-phase2.js — "📋 Kiểm Soát Hàng Hóa", bổ sung sau Phase 1 MVP (11/2026):
// Phần A (Sửa/Ngừng dùng Quầy Kệ) + Phần B (Ngưỡng Tồn & Email cảnh báo). Test TRỰC TIẾP logic server
// (lib/shelfStockEdit.js, lib/createValidation.js, lib/recordViewScope.js) + job
// jobs/shelfStockThresholdAlert.js (db/mailer giả, cùng khuôn tests/test-hr-task-overdue-reminder.js).
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

  // ===== Phần A: Sửa Quầy Kệ (lib/shelfStockEdit.js) =====
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

  // ===== Phần B: Tạo Ngưỡng Tồn (lib/createValidation.js, CREATE_MODULE_CONFIGS.shelfStockThresholds) =====
  await run.run('shelfStockThresholds: thiếu quyền -> CreateError 403', async () => {
    let caught = null;
    try {
      validateAndPrepareCreate('shelfStockThresholds', { scope: 'CATEGORY', scopeValue: 'Đồ uống', minQuantity: 10, recipientEmails: ['a@hcrc.vn'] }, userOf('Siêu thị Quận 1', {}), [], {});
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 403, `phải 403, thực tế: ${caught}`);
  });

  await run.run('shelfStockThresholds: scope không hợp lệ -> CreateError 400', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfLocationManage: true });
    let caught = null;
    try {
      validateAndPrepareCreate('shelfStockThresholds', { scope: 'FOO', scopeValue: 'x', minQuantity: 10, recipientEmails: ['a@hcrc.vn'] }, user, [], {});
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 400, `phải 400, thực tế: ${caught}`);
  });

  await run.run('shelfStockThresholds: ngưỡng âm -> CreateError 400', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfLocationManage: true });
    let caught = null;
    try {
      validateAndPrepareCreate('shelfStockThresholds', { scope: 'SKU', scopeValue: 'SKU001', minQuantity: -5, recipientEmails: ['a@hcrc.vn'] }, user, [], {});
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 400, `phải 400, thực tế: ${caught}`);
  });

  await run.run('shelfStockThresholds: email không hợp lệ -> CreateError 400', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfLocationManage: true });
    let caught = null;
    try {
      validateAndPrepareCreate('shelfStockThresholds', { scope: 'SKU', scopeValue: 'SKU001', minQuantity: 10, recipientEmails: ['khong-phai-email'] }, user, [], {});
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 400, `phải 400, thực tế: ${caught}`);
  });

  await run.run('shelfStockThresholds: hợp lệ -> tạo OK, dept LUÔN = user.dept (forceOwnDept)', async () => {
    const user = userOf('Siêu thị Quận 1', { shelfLocationManage: true });
    const record = validateAndPrepareCreate('shelfStockThresholds', {
      scope: 'CATEGORY', scopeValue: 'Đồ uống', minQuantity: 10, recipientEmails: [' a@hcrc.vn ', 'b@hcrc.vn'], dept: 'Siêu thị Quận 7 (giả mạo)'
    }, user, [], {});
    assertEqual(record.dept, 'Siêu thị Quận 1', 'dept phải = user.dept');
    assertEqual(record.scope, 'CATEGORY');
    assertEqual(record.minQuantity, 10);
    assertEqual(JSON.stringify(record.recipientEmails), JSON.stringify(['a@hcrc.vn', 'b@hcrc.vn']), 'email phải trim');
    assertEqual(record.active, true);
  });

  await run.run('shelfStockThresholds: trùng scope+scopeValue CHỈ chặn trong CÙNG siêu thị', async () => {
    const user1 = userOf('Siêu thị Quận 1', { shelfLocationManage: true });
    const user7 = userOf('Siêu thị Quận 7', { shelfLocationManage: true });
    const existing = [{ id: 1, dept: 'Siêu thị Quận 1', scope: 'CATEGORY', scopeValue: 'Đồ uống', active: true }];
    let caught = null;
    try {
      validateAndPrepareCreate('shelfStockThresholds', { scope: 'CATEGORY', scopeValue: 'Đồ uống', minQuantity: 5, recipientEmails: ['a@hcrc.vn'] }, user1, existing, {});
    } catch (err) { caught = err; }
    assert(caught instanceof CreateError && caught.status === 409, 'phải báo trùng trong CÙNG siêu thị');

    const record7 = validateAndPrepareCreate('shelfStockThresholds', { scope: 'CATEGORY', scopeValue: 'Đồ uống', minQuantity: 5, recipientEmails: ['a@hcrc.vn'] }, user7, existing, {});
    assertEqual(record7.dept, 'Siêu thị Quận 7', 'siêu thị khác vẫn tạo được ngưỡng cùng phạm vi');
  });

  // ===== Phần B: Sửa Ngưỡng Tồn (lib/shelfStockEdit.js) =====
  await run.run('applyShelfStockThresholdEdit: siêu thị khác -> HttpError 403, scope/scopeValue bất biến', async () => {
    const item = { id: 1, dept: 'Siêu thị Quận 1', scope: 'SKU', scopeValue: 'SKU001', minQuantity: 10, recipientEmails: ['a@hcrc.vn'], active: true };
    let caught = null;
    try { applyShelfStockThresholdEdit(item, { minQuantity: 20 }, userOf('Siêu thị Quận 7', { shelfLocationManage: true })); }
    catch (err) { caught = err; }
    assert(caught instanceof HttpError && caught.status === 403, `phải 403, thực tế: ${caught}`);

    const next = applyShelfStockThresholdEdit(item, { minQuantity: 20, scope: 'CATEGORY', scopeValue: 'HACK', recipientEmails: ['b@hcrc.vn'], active: false }, userOf('Siêu thị Quận 1', { shelfLocationManage: true }));
    assertEqual(next.minQuantity, 20);
    assertEqual(next.scope, 'SKU', 'scope KHÔNG đổi dù client gửi "CATEGORY"');
    assertEqual(next.scopeValue, 'SKU001', 'scopeValue KHÔNG đổi dù client gửi "HACK"');
    assertEqual(next.active, false);
  });

  // ===== recordViewScope.js =====
  await run.run('MODULE_ACCESS_GATED_COLLECTIONS.vanHanh có shelfStockThresholds', async () => {
    assert(MODULE_ACCESS_GATED_COLLECTIONS.vanHanh.includes('shelfStockThresholds'), 'thiếu shelfStockThresholds');
  });
  await run.run('canViewShelfStockThreshold/filterShelfStockThresholdsForUser mirror shelfLocations', async () => {
    const items = [{ id: 1, dept: 'Siêu thị Quận 1' }, { id: 2, dept: 'Siêu thị Quận 7' }];
    const user1 = userOf('Siêu thị Quận 1', {});
    assertEqual(filterShelfStockThresholdsForUser(items, user1).length, 1, 'chỉ thấy đúng siêu thị mình');
    const userAll = userOf('Siêu thị Quận 1', { shelfReportViewAll: true });
    assertEqual(filterShelfStockThresholdsForUser(items, userAll).length, 2, 'shelfReportViewAll thấy tất cả');
  });

  // ===== jobs/shelfStockThresholdAlert.js (db/mailer giả, cùng khuôn test-hr-task-overdue-reminder.js) =====
  const STORE = {
    shelfStockThresholds: [],
    shelfRecords: [],
    shelfLocations: []
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

  await run.run('job: SKU dưới ngưỡng -> gửi email; SKU đủ ngưỡng -> không gửi; siêu thị khác không bị tính nhầm', async () => {
    sentMails = [];
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', scope: 'SKU', scopeValue: 'SKU001', minQuantity: 10, recipientEmails: ['low@hcrc.vn'], active: true },
      { id: 2, dept: 'Siêu thị Quận 1', scope: 'SKU', scopeValue: 'SKU002', minQuantity: 5, recipientEmails: ['ok@hcrc.vn'], active: true }
    ];
    STORE.shelfLocations = [{ id: 100, dept: 'Siêu thị Quận 1', code: 'A1', category: 'Đồ uống' }];
    STORE.shelfRecords = [
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, sku: 'SKU001', quantity: 3, createdAt: todayIso() },
      { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 100, sku: 'SKU002', quantity: 8, createdAt: todayIso() },
      // Siêu thị khác, cùng SKU001 — KHÔNG được cộng vào tổng của Siêu thị Quận 1.
      { id: 3, dept: 'Siêu thị Quận 7', shelfLocationId: 200, sku: 'SKU001', quantity: 100, createdAt: todayIso() }
    ];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 1, `phải gửi đúng 1 email (SKU001 thiếu), thực tế: ${JSON.stringify(sentMails)}`);
    assertEqual(JSON.stringify(sentMails[0].to), JSON.stringify(['low@hcrc.vn']), 'phải gửi đúng người nhận của SKU001');
  });

  await run.run('job: CATEGORY tra category qua shelfLocationId (shelfRecords không lưu category trực tiếp)', async () => {
    sentMails = [];
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', scope: 'CATEGORY', scopeValue: 'Đồ uống', minQuantity: 20, recipientEmails: ['cat@hcrc.vn'], active: true }
    ];
    STORE.shelfLocations = [
      { id: 100, dept: 'Siêu thị Quận 1', code: 'A1', category: 'Đồ uống' },
      { id: 101, dept: 'Siêu thị Quận 1', code: 'A2', category: 'Bánh kẹo' }
    ];
    STORE.shelfRecords = [
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, sku: 'X1', quantity: 5, createdAt: todayIso() },
      { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 101, sku: 'X2', quantity: 50, createdAt: todayIso() } // ngành hàng khác, không tính
    ];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 1, `tổng Đồ uống = 5 < 20 -> phải cảnh báo, thực tế: ${JSON.stringify(sentMails)}`);
  });

  await run.run('job: ngưỡng active=false -> bỏ qua hoàn toàn', async () => {
    sentMails = [];
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', scope: 'SKU', scopeValue: 'SKU999', minQuantity: 100, recipientEmails: ['x@hcrc.vn'], active: false }
    ];
    STORE.shelfLocations = [];
    STORE.shelfRecords = [];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 0, 'ngưỡng ngừng dùng không được gửi email');
  });

  await run.run('job: không có ghi nhận hôm nay -> tổng = 0, LUÔN dưới ngưỡng -> cảnh báo', async () => {
    sentMails = [];
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', scope: 'SKU', scopeValue: 'SKU777', minQuantity: 1, recipientEmails: ['empty@hcrc.vn'], active: true }
    ];
    STORE.shelfLocations = [];
    STORE.shelfRecords = [];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 1, 'không có bản ghi hôm nay vẫn phải cảnh báo (tổng=0 < ngưỡng)');
  });

  run.summary();
}

main().catch(err => { console.error(err); process.exit(1); });
