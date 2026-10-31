// tests/test-shelf-threshold-migration-and-import.js — THIẾT KẾ LẠI Ngưỡng Tồn (11/2026): di trú dữ
// liệu cũ (jobs/legacyShelfStockThresholdMigration.js), cổng lọc opt-out dùng chung cho job cron
// (lib/notifyEmailModulesGate.js), và Nhập Excel Ngưỡng Tồn (lib/shelfThresholdImport.js).
'use strict';
const { createRunner, assert, assertEqual } = require('./testHarness');
const { migrateOneThreshold } = require('../jobs/legacyShelfStockThresholdMigration');
const { isUserOptedOutOfEmailModule } = require('../lib/notifyEmailModulesGate');
const { buildShelfThresholdTemplateWorkbook, parseShelfThresholdFile } = require('../lib/shelfThresholdImport');

async function main() {
  const run = createRunner();

  // ===== lib/notifyEmailModulesGate.js =====
  await run.run('isUserOptedOutOfEmailModule: false RÕ RÀNG -> true (đã tắt)', () => {
    assertEqual(isUserOptedOutOfEmailModule({ notifyEmailModules: { SHELF_THRESHOLD: false } }, 'SHELF_THRESHOLD'), true);
  });
  await run.run('isUserOptedOutOfEmailModule: fail-open khi chưa có notifyEmailModules/field', () => {
    assertEqual(isUserOptedOutOfEmailModule({}, 'SHELF_THRESHOLD'), false, 'user chưa từng mở màn cấu hình -> vẫn gửi');
    assertEqual(isUserOptedOutOfEmailModule({ notifyEmailModules: { OTHER: false } }, 'SHELF_THRESHOLD'), false, 'khác module -> không ảnh hưởng');
    assertEqual(isUserOptedOutOfEmailModule(null, 'SHELF_THRESHOLD'), false, 'user null -> fail-open');
  });
  await run.run('isUserOptedOutOfEmailModule: true/giá trị khác false -> fail-open (vẫn gửi)', () => {
    assertEqual(isUserOptedOutOfEmailModule({ notifyEmailModules: { SHELF_THRESHOLD: true } }, 'SHELF_THRESHOLD'), false);
  });

  // ===== jobs/legacyShelfStockThresholdMigration.js =====
  await run.run('migrateOneThreshold: không có field "scope" -> bỏ qua, idempotent (đã di trú/chưa từng cũ)', () => {
    const item = { id: 1, dept: 'Siêu thị Quận 1', maHang: 'SKU001', maVach: '', category: '', minQuantity: 10, active: true };
    const { item: next, changed } = migrateOneThreshold(item, new Map());
    assertEqual(changed, false);
    assertEqual(next, item, 'phải trả về NGUYÊN item cũ, không tạo bản sao khi không cần di trú');
  });

  await run.run('migrateOneThreshold: scope=SKU -> maHang = scopeValue', () => {
    const item = { id: 1, dept: 'Siêu thị Quận 1', scope: 'SKU', scopeValue: '2003330491', minQuantity: 10, active: true };
    const { item: next, changed } = migrateOneThreshold(item, new Map());
    assertEqual(changed, true);
    assertEqual(next.maHang, '2003330491');
    assertEqual(next.scope, undefined, 'field cũ phải bị xoá');
    assertEqual(next.scopeValue, undefined);
  });

  await run.run('migrateOneThreshold: scope=CATEGORY -> category = scopeValue', () => {
    const item = { id: 1, dept: 'Siêu thị Quận 1', scope: 'CATEGORY', scopeValue: 'Đồ uống', minQuantity: 10, active: true };
    const { item: next } = migrateOneThreshold(item, new Map());
    assertEqual(next.category, 'Đồ uống');
  });

  await run.run('migrateOneThreshold: recipientEmails khớp user active -> chuyển thành extraRecipientUsernames (dedup)', () => {
    const usersByEmailLower = new Map([
      ['a@hcrc.vn', { username: 'cht1', active: true }],
      ['b@hcrc.vn', { username: 'cht2', active: true }]
    ]);
    const item = {
      id: 1, dept: 'Siêu thị Quận 1', scope: 'SKU', scopeValue: 'SKU001', minQuantity: 10, active: true,
      recipientEmails: ['A@HCRC.VN', 'b@hcrc.vn'], extraRecipientUsernames: ['cht1'] // cht1 đã có sẵn (migrate đợt trước dở dang) -> không trùng
    };
    const { item: next, unmigratedCount } = migrateOneThreshold(item, usersByEmailLower);
    assertEqual(unmigratedCount, 0);
    assertEqual(JSON.stringify([...next.extraRecipientUsernames].sort()), JSON.stringify(['cht1', 'cht2']), 'phải khớp email KHÔNG phân biệt hoa/thường + dedup');
    assertEqual(next.recipientEmails, undefined);
  });

  await run.run('migrateOneThreshold: email KHÔNG khớp tài khoản nào -> giữ lại ở unmigratedExternalEmails, KHÔNG xoá mất', () => {
    const usersByEmailLower = new Map();
    const item = { id: 1, dept: 'Siêu thị Quận 1', scope: 'SKU', scopeValue: 'SKU001', minQuantity: 10, active: true, recipientEmails: ['ngoai@gmail.com'] };
    const { item: next, unmigratedCount } = migrateOneThreshold(item, usersByEmailLower);
    assertEqual(unmigratedCount, 1);
    assertEqual(JSON.stringify(next.unmigratedExternalEmails), JSON.stringify(['ngoai@gmail.com']), 'email không khớp phải được GIỮ LẠI, không âm thầm xoá');
  });

  await run.run('migrateOneThreshold: user INACTIVE không nằm trong usersByEmailLower (migrateLegacyShelfStockThresholds chỉ đưa user active vào map) -> coi như không khớp, giữ lại unmigrated', () => {
    // usersByEmailLower được build Ở NGOÀI (migrateLegacyShelfStockThresholds) với .filter(u.active !== false)
    // TRƯỚC khi gọi migrateOneThreshold() — user inactive không bao giờ có mặt trong map, mô phỏng đúng ở đây.
    const usersByEmailLower = new Map();
    const item = { id: 1, dept: 'Siêu thị Quận 1', scope: 'SKU', scopeValue: 'SKU001', minQuantity: 10, active: true, recipientEmails: ['a@hcrc.vn'] };
    const { item: next } = migrateOneThreshold(item, usersByEmailLower);
    assertEqual(JSON.stringify(next.extraRecipientUsernames), JSON.stringify([]));
    assertEqual(JSON.stringify(next.unmigratedExternalEmails), JSON.stringify(['a@hcrc.vn']));
  });

  // ===== lib/shelfThresholdImport.js =====
  await run.run('buildShelfThresholdTemplateWorkbook: tạo được workbook với đúng 4 cột', async () => {
    const wb = await buildShelfThresholdTemplateWorkbook();
    const sheet = wb.getWorksheet('Ngưỡng Tồn');
    assert(!!sheet, 'phải có sheet "Ngưỡng Tồn"');
    const headerRow = sheet.getRow(1).values.filter(Boolean);
    assertEqual(headerRow.length, 4, `phải đúng 4 cột, thực tế: ${JSON.stringify(headerRow)}`);
  });

  await run.run('parseShelfThresholdFile (csv): đọc đúng maHang/maVach/category/minQuantity, bỏ dòng thiếu cả 3 nhận diện', async () => {
    const csv = [
      'Mã Hàng (nội bộ),Mã Vạch,Ngành Hàng,Ngưỡng Tối Thiểu',
      '2003330491,8934696001589,,20',
      ',,Nước giải khát,10',
      ',,,5', // thiếu cả 3 -> bị loại
      '2003330492,,,abc' // ngưỡng không phải số -> bị loại
    ].join('\n');
    const items = await parseShelfThresholdFile(Buffer.from(csv, 'utf8'), '.csv');
    assertEqual(items.length, 2, `phải đọc đúng 2 dòng hợp lệ, thực tế: ${JSON.stringify(items)}`);
    assertEqual(items[0].maHang, '2003330491');
    assertEqual(items[0].maVach, '8934696001589');
    assertEqual(items[0].minQuantity, 20);
    assertEqual(items[1].category, 'Nước giải khát');
  });

  await run.run('parseShelfThresholdFile (csv): trùng tổ hợp NGAY TRONG file -> chỉ giữ dòng đầu', async () => {
    const csv = [
      'Mã Hàng (nội bộ),Mã Vạch,Ngành Hàng,Ngưỡng Tối Thiểu',
      '2003330491,,,20',
      '2003330491,,,999'
    ].join('\n');
    const items = await parseShelfThresholdFile(Buffer.from(csv, 'utf8'), '.csv');
    assertEqual(items.length, 1);
    assertEqual(items[0].minQuantity, 20, 'phải giữ dòng đầu, bỏ dòng trùng sau');
  });

  await run.run('parseShelfThresholdFile (csv): toàn dòng không hợp lệ -> HttpError 400', async () => {
    const csv = ['Mã Hàng (nội bộ),Mã Vạch,Ngành Hàng,Ngưỡng Tối Thiểu', ',,,abc'].join('\n');
    let caught = null;
    try { await parseShelfThresholdFile(Buffer.from(csv, 'utf8'), '.csv'); } catch (err) { caught = err; }
    assert(caught && caught.status === 400, `phải báo lỗi 400, thực tế: ${caught}`);
  });

  run.summary();
}

main().catch(err => { console.error(err); process.exit(1); });
