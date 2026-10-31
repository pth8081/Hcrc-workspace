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
  // — THIẾT KẾ LẠI LẦN 2 (11/2026): báo cáo TỔNG HỢP (digest) gửi theo LỊCH cấu hình được
  // (DAILY/WEEKLY/MONTHLY), 1 email/người nhận (không còn 1 email/điều kiện vi phạm như bản cũ), đính
  // kèm Excel tô màu đỏ/vàng/an toàn theo classifyThresholdStatus() =====
  const ExcelJS = require('exceljs');
  const { classifyThresholdStatus } = require('../lib/shelfThresholdDigestExcel');
  const STORE = {
    shelfStockThresholds: [],
    shelfRecords: [],
    shelfLocations: [],
    users: [],
    shelfThresholdDigestSchedule: {}
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
    sql: { NVarChar: () => 'NVARCHAR', MAX: 'MAX' }
  });
  stubModule('lib/systemLogStore', { insertSystemLog: async () => {} });
  stubModule('lib/emailCrypto', { decryptSecret: (s) => s });
  stubModule('lib/emailTemplate', { buildNotificationEmailHtml: () => '<html></html>' });
  let sentMails = [];
  stubModule('lib/mailer', {
    sendMail: async ({ to, subject, attachments }) => { sentMails.push({ to, subject, attachments }); return { sent: to, failed: [], simulated: false }; },
    resolveEncryption: () => 'STARTTLS',
    resolveGraphOption: () => null,
    resolveEwsOption: () => null
  });
  const { checkShelfStockThresholdAlerts, shouldSendDigestNow, getPeriodKey, buildDigestRowsForDept, groupDigestRowsByRecipient } = require('../jobs/shelfStockThresholdAlert');

  // scheduleMatchingNow(): cấu hình lịch LUÔN khớp đúng thời điểm test đang chạy (tránh phải mock Date)
  // — mặc định DAILY ở ĐÚNG giờ hiện tại, lastSentPeriodKey=null (chưa gửi kỳ nào) để job THỰC SỰ chạy.
  function scheduleMatchingNow(overrides) {
    const now = new Date();
    return { frequency: 'DAILY', hour: now.getHours(), dayOfWeek: now.getDay(), dayOfMonth: Math.min(28, now.getDate()), lastSentPeriodKey: null, ...(overrides || {}) };
  }

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

  // ----- Unit test thuần (không mock db/mailer) cho 3 hàm lõi -----
  await run.run('classifyThresholdStatus: đúng biên RED/YELLOW/GREEN (10%)', async () => {
    assertEqual(classifyThresholdStatus(9, 10), 'RED', '9 < 10 -> RED');
    assertEqual(classifyThresholdStatus(10, 10), 'YELLOW', '10 == minQuantity -> YELLOW (chưa phải RED)');
    assertEqual(classifyThresholdStatus(10.999, 10), 'YELLOW', '10.999 < 11 (10*1.1) -> YELLOW');
    assertEqual(classifyThresholdStatus(11, 10), 'GREEN', '11 == 10*1.1 chẵn -> GREEN (biên trên KHÔNG tính vàng)');
    assertEqual(classifyThresholdStatus(20, 10), 'GREEN', '20 >= 11 -> GREEN');
    assertEqual(classifyThresholdStatus(0, 0), 'GREEN', 'ngưỡng=0, tồn=0 -> GREEN (không có minQuantity dương để so)');
  });

  await run.run('shouldSendDigestNow: khớp đúng DAILY/WEEKLY/MONTHLY theo giờ/thứ/ngày cấu hình', async () => {
    const now = new Date(2026, 10, 9, 7, 0, 0); // giả định 1 thời điểm cố định để test độc lập giờ chạy thật
    assert(shouldSendDigestNow({ frequency: 'DAILY', hour: 7 }, now), 'DAILY đúng giờ 7h -> true');
    assert(!shouldSendDigestNow({ frequency: 'DAILY', hour: 8 }, now), 'DAILY sai giờ -> false');
    assert(shouldSendDigestNow({ frequency: 'WEEKLY', hour: 7, dayOfWeek: now.getDay() }, now), 'WEEKLY đúng thứ+giờ -> true');
    assert(!shouldSendDigestNow({ frequency: 'WEEKLY', hour: 7, dayOfWeek: (now.getDay() + 1) % 7 }, now), 'WEEKLY sai thứ -> false');
    assert(shouldSendDigestNow({ frequency: 'MONTHLY', hour: 7, dayOfMonth: now.getDate() }, now), 'MONTHLY đúng ngày+giờ -> true');
    assert(!shouldSendDigestNow({ frequency: 'MONTHLY', hour: 7, dayOfMonth: now.getDate() + 1 }, now), 'MONTHLY sai ngày -> false');
  });

  await run.run('groupDigestRowsByRecipient: quản lý vùng phụ trách 2 siêu thị nhận ĐÚNG 1 email gộp cả 2, không phải 2 email riêng', async () => {
    const users = [
      { username: 'qlv', name: 'QLV 2 Vùng', dept: 'Phòng Vận Hành', active: true, email: 'qlv@hcrc.vn', perms: { shelfReportView: { all: false, depts: ['Siêu thị A', 'Siêu thị B'] } } }
    ];
    const thresholds = [
      { id: 1, dept: 'Siêu thị A', maHang: 'SKUA', maVach: '', category: '', minQuantity: 10, extraRecipientUsernames: [], active: true },
      { id: 2, dept: 'Siêu thị B', maHang: 'SKUB', maVach: '', category: '', minQuantity: 10, extraRecipientUsernames: [], active: true }
    ];
    const groups = groupDigestRowsByRecipient(thresholds, users, [], new Map());
    assertEqual(groups.length, 1, `phải đúng 1 nhóm (1 email) cho qlv, thực tế: ${JSON.stringify(groups)}`);
    assertEqual(groups[0].email, 'qlv@hcrc.vn');
    assertEqual(groups[0].rows.length, 2, 'phải có đủ 2 dòng (cả Siêu thị A lẫn B) trong CÙNG 1 email');
  });

  await run.run('buildDigestRowsForDept: liệt kê CẢ dòng an toàn (GREEN), không chỉ dòng vi phạm (khác bản alert tức thời cũ)', async () => {
    const thresholds = [
      { id: 1, dept: 'Siêu thị A', maHang: 'SKU_OK', maVach: '', category: '', minQuantity: 10, active: true }
    ];
    const records = [{ id: 1, dept: 'Siêu thị A', shelfLocationId: 1, maHang: 'SKU_OK', maVach: '', quantity: 50, createdAt: todayIso() }];
    const rows = buildDigestRowsForDept('Siêu thị A', thresholds, records, new Map());
    assertEqual(rows.length, 1, 'phải có dòng dù an toàn (không bị lọc bỏ)');
    assertEqual(rows[0].status, 'GREEN');
  });

  // ----- Integration test đầy đủ job (mock db/mailer) -----
  await run.run('job: lịch CHƯA tới giờ cấu hình -> không tính toán, không gửi gì cả', async () => {
    sentMails = [];
    STORE.users = baseUsers();
    STORE.shelfThresholdDigestSchedule = scheduleMatchingNow({ hour: (new Date().getHours() + 2) % 24 }); // cố tình lệch giờ
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU001', maVach: '', category: '', minQuantity: 10, extraRecipientUsernames: [], active: true }
    ];
    STORE.shelfLocations = [];
    STORE.shelfRecords = [{ id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU001', maVach: '', quantity: 1, createdAt: todayIso() }];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 0, 'chưa tới giờ cấu hình thì tuyệt đối không gửi');
  });

  await run.run('job: đúng giờ cấu hình -> gửi digest, mỗi người nhận ĐÚNG 1 email (3 tầng tự động)', async () => {
    sentMails = [];
    STORE.users = baseUsers();
    STORE.shelfThresholdDigestSchedule = scheduleMatchingNow();
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU001', maVach: '', category: '', minQuantity: 10, extraRecipientUsernames: [], active: true },
      { id: 2, dept: 'Siêu thị Quận 1', maHang: 'SKU002', maVach: '', category: '', minQuantity: 5, extraRecipientUsernames: [], active: true }
    ];
    STORE.shelfLocations = [{ id: 100, dept: 'Siêu thị Quận 1', code: 'A1', category: 'Đồ uống' }];
    STORE.shelfRecords = [
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU001', maVach: '', quantity: 3, createdAt: todayIso() },
      { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU002', maVach: '', quantity: 8, createdAt: todayIso() },
      // Siêu thị khác, cùng SKU001 — KHÔNG được cộng vào tổng của Siêu thị Quận 1, cht7 cũng KHÔNG nhận vì không có ngưỡng nào ở Quận 7.
      { id: 3, dept: 'Siêu thị Quận 7', shelfLocationId: 200, maHang: 'SKU001', maVach: '', quantity: 100, createdAt: todayIso() }
    ];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 3, `phải gửi đúng 3 email RIÊNG (1/người, không gộp) — cht1/qlv1/bgd, thực tế: ${JSON.stringify(sentMails.map(m => m.to))}`);
    const recipients = sentMails.map(m => m.to[0]).sort();
    assertEqual(JSON.stringify(recipients), JSON.stringify(['bgd@hcrc.vn', 'cht1@hcrc.vn', 'qlv1@hcrc.vn']), `đúng 3 tầng tự động (không có cht7/khac), thực tế: ${JSON.stringify(recipients)}`);
    sentMails.forEach(m => assert(m.attachments && m.attachments.length === 1 && m.attachments[0].filename === 'BaoCaoNguongTon.xlsx', `mỗi email phải có đúng 1 file đính kèm .xlsx, thực tế: ${JSON.stringify(m.attachments)}`));
  });

  await run.run('job: file Excel đính kèm có đúng 2 dòng (SKU001 đỏ, SKU002 an toàn) và tô màu đúng', async () => {
    sentMails = [];
    STORE.users = [baseUsers()[0]]; // chỉ cht1 để test đơn giản 1 email
    STORE.shelfThresholdDigestSchedule = scheduleMatchingNow();
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU001', maVach: '', category: '', minQuantity: 10, extraRecipientUsernames: [], active: true }, // 3 < 10 -> RED
      { id: 2, dept: 'Siêu thị Quận 1', maHang: 'SKU002', maVach: '', category: '', minQuantity: 5, extraRecipientUsernames: [], active: true }   // 50 >= 5.5 -> GREEN
    ];
    STORE.shelfLocations = [];
    STORE.shelfRecords = [
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU001', maVach: '', quantity: 3, createdAt: todayIso() },
      { id: 2, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU002', maVach: '', quantity: 50, createdAt: todayIso() }
    ];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 1);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(sentMails[0].attachments[0].content);
    const sheet = wb.getWorksheet('Ngưỡng Tồn');
    assertEqual(sheet.getRow(2).getCell(2).value, 'SKU001');
    assertEqual(sheet.getRow(2).getCell(6).value, 3, 'cột Tồn Hôm Nay dòng SKU001 phải = 3');
    assertEqual(sheet.getRow(2).getCell(1).fill.fgColor.argb, 'FFFFC7CE', 'dòng SKU001 (dưới ngưỡng) phải tô ĐỎ');
    assertEqual(sheet.getRow(3).getCell(2).value, 'SKU002');
    assert(!sheet.getRow(3).getCell(1).fill, 'dòng SKU002 (an toàn) KHÔNG được tô màu');
  });

  await run.run('job: "nhập 1 là đủ, nhập nhiều thì check nhiều điều kiện" — ngưỡng điền cả SKU lẫn ngành hàng ra 2 dòng độc lập trong CÙNG 1 email', async () => {
    sentMails = [];
    STORE.users = [baseUsers()[0]];
    STORE.shelfThresholdDigestSchedule = scheduleMatchingNow();
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU001', maVach: '', category: 'Đồ uống', minQuantity: 10, extraRecipientUsernames: [], active: true }
    ];
    STORE.shelfLocations = [{ id: 100, dept: 'Siêu thị Quận 1', code: 'A1', category: 'Đồ uống' }];
    STORE.shelfRecords = [
      { id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU001', maVach: '', quantity: 3, createdAt: todayIso() }
    ];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 1, 'vẫn chỉ 1 email (không tách theo điều kiện như bản cũ)');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(sentMails[0].attachments[0].content);
    const sheet = wb.getWorksheet('Ngưỡng Tồn');
    assertEqual(sheet.rowCount >= 3, true, 'phải có >= 2 dòng dữ liệu (1 SKU + 1 Ngành Hàng) + 1 dòng tiêu đề');
  });

  await run.run('job: Tầng 4 (extraRecipientUsernames) được cộng thêm vào danh sách tự động, dedup đúng (không gửi trùng)', async () => {
    sentMails = [];
    const users = baseUsers();
    users.push({ username: 'extra1', name: 'Nhân Viên Thêm', dept: 'Siêu thị Quận 1', active: true, email: 'extra1@hcrc.vn', perms: {} });
    STORE.users = users;
    STORE.shelfThresholdDigestSchedule = scheduleMatchingNow();
    STORE.shelfStockThresholds = [
      // cht1 vừa thuộc Tầng 1 (tự động) vừa bị thêm lại ở Tầng 4 -> không gửi trùng (1 email, không phải 2).
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU001', maVach: '', category: '', minQuantity: 10, extraRecipientUsernames: ['extra1', 'cht1'], active: true }
    ];
    STORE.shelfLocations = [];
    STORE.shelfRecords = [{ id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU001', maVach: '', quantity: 3, createdAt: todayIso() }];
    await checkShelfStockThresholdAlerts();
    const recipients = sentMails.map(m => m.to[0]).sort();
    assertEqual(JSON.stringify(recipients), JSON.stringify(['bgd@hcrc.vn', 'cht1@hcrc.vn', 'extra1@hcrc.vn', 'qlv1@hcrc.vn']), `phải cộng thêm extra1, cht1 không gửi trùng, thực tế: ${JSON.stringify(recipients)}`);
  });

  await run.run('job: user đã tự tắt notifyEmailModules.SHELF_THRESHOLD=false -> bị loại khỏi người nhận', async () => {
    sentMails = [];
    const users = baseUsers();
    users[0].notifyEmailModules = { SHELF_THRESHOLD: false }; // cht1 tự tắt
    STORE.users = users;
    STORE.shelfThresholdDigestSchedule = scheduleMatchingNow();
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU001', maVach: '', category: '', minQuantity: 10, extraRecipientUsernames: [], active: true }
    ];
    STORE.shelfLocations = [];
    STORE.shelfRecords = [{ id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU001', maVach: '', quantity: 3, createdAt: todayIso() }];
    await checkShelfStockThresholdAlerts();
    const recipients = sentMails.map(m => m.to[0]).sort();
    assert(!recipients.includes('cht1@hcrc.vn'), `cht1 đã tắt nhận email, KHÔNG được có trong danh sách, thực tế: ${JSON.stringify(recipients)}`);
    assertEqual(JSON.stringify(recipients), JSON.stringify(['bgd@hcrc.vn', 'qlv1@hcrc.vn']));
  });

  await run.run('job: ngưỡng active=false -> bỏ qua hoàn toàn (không ai nhận gì)', async () => {
    sentMails = [];
    STORE.users = baseUsers();
    STORE.shelfThresholdDigestSchedule = scheduleMatchingNow();
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU999', maVach: '', category: '', minQuantity: 100, extraRecipientUsernames: [], active: false }
    ];
    STORE.shelfLocations = [];
    STORE.shelfRecords = [];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 0, 'ngưỡng ngừng dùng không được gửi email');
  });

  await run.run('job: kỳ này ĐÃ gửi rồi (lastSentPeriodKey khớp) -> không gửi trùng dù vẫn đúng giờ cấu hình', async () => {
    sentMails = [];
    STORE.users = baseUsers();
    const now = new Date();
    const schedule = scheduleMatchingNow();
    schedule.lastSentPeriodKey = getPeriodKey(now, schedule.frequency); // giả lập "đã gửi kỳ này rồi"
    STORE.shelfThresholdDigestSchedule = schedule;
    STORE.shelfStockThresholds = [
      { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU001', maVach: '', category: '', minQuantity: 10, extraRecipientUsernames: [], active: true }
    ];
    STORE.shelfLocations = [];
    STORE.shelfRecords = [{ id: 1, dept: 'Siêu thị Quận 1', shelfLocationId: 100, maHang: 'SKU001', maVach: '', quantity: 1, createdAt: todayIso() }];
    await checkShelfStockThresholdAlerts();
    assertEqual(sentMails.length, 0, 'kỳ đã gửi rồi (chống trùng khi server restart/tick chạy lại đúng giờ khớp lịch) -> không gửi lại');
  });

  run.summary();
}

main().catch(err => { console.error(err); process.exit(1); });
