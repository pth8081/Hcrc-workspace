// tests/test-shelf-recon-digest.js — "📊 Báo Cáo Đối Chiếu" (Kiểm Soát Hàng Hóa, 11/2026, theo yêu cầu
// người dùng: "đối chiếu cũng sẽ đặt lịch gửi email được") — test logic THUẦN (buildReconMismatchRowsForDept/
// groupReconDigestRowsByRecipient/isToday ở jobs/shelfStockReconDigestAlert.js + Excel export +
// validate cấu trúc lịch) bằng cách mock lib/inventorySnapshotStore.js qua require.cache (CÙNG kỹ thuật
// tests/test-inventory-recon.js dùng cho jobs/inventorySync.js) + 1 bộ guard regex trên nguồn
// routes/shelfStock.js (recon-recipients)/routes/data.js (gate/strip shelfReconExtraRecipients) — cùng
// khuôn 2 test "guard" cuối tests/test-inventory-recon.js.
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { assertShelfReconDigestScheduleSafeToSave } = require('../lib/createValidation');
const { buildShelfReconDigestExcelBuffer } = require('../lib/shelfReconDigestExcel');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

// requireFreshReconDigestJob(store) — nạp lại jobs/shelfStockReconDigestAlert.js "sạch", trỏ
// require('../jobs/inventorySync') (bên trong nó, qua getSystemInventoryForMaDiem) sang 1 bản fake đọc
// thẳng store.systemInventorySnapshot.byMaDiem — mô phỏng ĐÚNG hình dạng dữ liệu thật (xem
// lib/inventorySnapshotStore.js), KHÔNG cần mock toàn bộ chuỗi phụ thuộc getPool()/mssql của module đó.
function makeFakeInventorySync(store) {
  return {
    async getSystemInventoryForMaDiem(maDiemRaw) {
      if (!maDiemRaw) return null;
      const snap = store.systemInventorySnapshot;
      return (snap && snap.byMaDiem && snap.byMaDiem[maDiemRaw]) ? snap.byMaDiem[maDiemRaw] : null;
    }
  };
}
function requireFreshReconDigestJob(store) {
  const inventorySyncPath = require.resolve('../jobs/inventorySync');
  const jobPath = require.resolve('../jobs/shelfStockReconDigestAlert');
  require.cache[inventorySyncPath] = { id: inventorySyncPath, filename: inventorySyncPath, loaded: true, exports: makeFakeInventorySync(store) };
  delete require.cache[jobPath];
  const mod = require('../jobs/shelfStockReconDigestAlert');
  return { ...mod, cleanup: () => { delete require.cache[inventorySyncPath]; delete require.cache[jobPath]; } };
}

function userOf(username, dept, perms, extra) {
  return { username, name: username, dept, email: `${username}@x.com`, active: true, perms: perms || {}, ...(extra || {}) };
}

async function main() {
  console.log('== jobs/shelfStockReconDigestAlert.js — buildReconMismatchRowsForDept() ==');

  await test('Mã đã scan hôm nay + lệch -> trả về đúng dòng (diff != 0)', async () => {
    const store = { systemInventorySnapshot: { byMaDiem: { '001': { rows: [{ maHang: 'SP001', tenHang: 'Bánh quy', soLuongTon: 30 }] } } } };
    const { buildReconMismatchRowsForDept, cleanup } = requireFreshReconDigestJob(store);
    try {
      const today = new Date().toISOString();
      const shelfRecords = [{ dept: 'Siêu thị Quận 1', maHang: 'SP001', quantity: 25, createdAt: today, lastScannedAt: today }];
      const rows = await buildReconMismatchRowsForDept('Siêu thị Quận 1', '001', shelfRecords);
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].diff, -5, 'shelfTotal(25) - soLuongTon(30) = -5');
      assert.strictEqual(rows[0].dept, 'Siêu thị Quận 1');
    } finally { cleanup(); }
  });

  await test('Mã khớp đúng (diff=0) -> KHÔNG đưa vào báo cáo (chỉ gửi mã lệch)', async () => {
    const store = { systemInventorySnapshot: { byMaDiem: { '001': { rows: [{ maHang: 'SP001', soLuongTon: 25 }] } } } };
    const { buildReconMismatchRowsForDept, cleanup } = requireFreshReconDigestJob(store);
    try {
      const today = new Date().toISOString();
      const shelfRecords = [{ dept: 'Siêu thị Quận 1', maHang: 'SP001', quantity: 25, createdAt: today, lastScannedAt: today }];
      const rows = await buildReconMismatchRowsForDept('Siêu thị Quận 1', '001', shelfRecords);
      assert.strictEqual(rows.length, 0, 'mã khớp đúng không được xuất hiện trong báo cáo email');
    } finally { cleanup(); }
  });

  await test('Mã CHƯA scan hôm nay (dù hệ thống có tồn) -> bỏ qua, không tính là lệch', async () => {
    const store = { systemInventorySnapshot: { byMaDiem: { '001': { rows: [{ maHang: 'SP001', soLuongTon: 30 }, { maHang: 'SP002', soLuongTon: 10 }] } } } };
    const { buildReconMismatchRowsForDept, cleanup } = requireFreshReconDigestJob(store);
    try {
      const today = new Date().toISOString();
      // Chỉ SP001 được scan hôm nay — SP002 (dù tồn kho hệ thống có 10) không được đưa vào xét.
      const shelfRecords = [{ dept: 'Siêu thị Quận 1', maHang: 'SP001', quantity: 30, createdAt: today, lastScannedAt: today }];
      const rows = await buildReconMismatchRowsForDept('Siêu thị Quận 1', '001', shelfRecords);
      assert.strictEqual(rows.length, 0, 'SP001 khớp đúng, SP002 chưa scan -> cả 2 đều không xuất hiện');
    } finally { cleanup(); }
  });

  await test('Ghi nhận của siêu thị KHÁC (dept khác) không được cộng vào tổng "Trên Kệ Hôm Nay"', async () => {
    const store = { systemInventorySnapshot: { byMaDiem: { '001': { rows: [{ maHang: 'SP001', soLuongTon: 5 }] } } } };
    const { buildReconMismatchRowsForDept, cleanup } = requireFreshReconDigestJob(store);
    try {
      const today = new Date().toISOString();
      const shelfRecords = [
        { dept: 'Siêu thị Quận 1', maHang: 'SP001', quantity: 5, createdAt: today, lastScannedAt: today },
        { dept: 'Siêu thị Quận 7', maHang: 'SP001', quantity: 100, createdAt: today, lastScannedAt: today }
      ];
      const rows = await buildReconMismatchRowsForDept('Siêu thị Quận 1', '001', shelfRecords);
      assert.strictEqual(rows.length, 0, 'Quận 1 khớp đúng (5=5) — ghi nhận Quận 7 không được lẫn vào');
    } finally { cleanup(); }
  });

  await test('Ghi nhận HÔM QUA (không phải hôm nay) không được tính vào "đã scan hôm nay"', async () => {
    const store = { systemInventorySnapshot: { byMaDiem: { '001': { rows: [{ maHang: 'SP001', soLuongTon: 30 }] } } } };
    const { buildReconMismatchRowsForDept, cleanup } = requireFreshReconDigestJob(store);
    try {
      const yesterday = new Date(Date.now() - 86400000).toISOString();
      const shelfRecords = [{ dept: 'Siêu thị Quận 1', maHang: 'SP001', quantity: 30, createdAt: yesterday, lastScannedAt: yesterday }];
      const rows = await buildReconMismatchRowsForDept('Siêu thị Quận 1', '001', shelfRecords);
      assert.strictEqual(rows.length, 0, 'ghi nhận hôm qua không được coi là "đã scan hôm nay"');
    } finally { cleanup(); }
  });

  await test('Không có maDiem -> trả về mảng rỗng, không throw', async () => {
    const store = {};
    const { buildReconMismatchRowsForDept, cleanup } = requireFreshReconDigestJob(store);
    try {
      const rows = await buildReconMismatchRowsForDept('Siêu thị Quận 1', null, []);
      assert.deepStrictEqual(rows, []);
    } finally { cleanup(); }
  });

  console.log('\n== jobs/shelfStockReconDigestAlert.js — groupReconDigestRowsByRecipient() ==');

  await test('Tầng 1 (shelfLocationManage + đúng dept) tự động nhận, thấy đúng mã lệch của siêu thị mình', async () => {
    const store = {};
    const { groupReconDigestRowsByRecipient, cleanup } = requireFreshReconDigestJob(store);
    try {
      const u1 = userOf('u1', 'Siêu thị Quận 1', { shelfLocationManage: true });
      const rowsByDept = new Map([['Siêu thị Quận 1', [{ dept: 'Siêu thị Quận 1', maHang: 'SP001', diff: -5 }]]]);
      const groups = groupReconDigestRowsByRecipient(['Siêu thị Quận 1'], [u1], {}, rowsByDept);
      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0].email, 'u1@x.com');
      assert.strictEqual(groups[0].rows.length, 1);
    } finally { cleanup(); }
  });

  await test('Tầng 3 (shelfReportView.all) nhận ĐỦ mọi siêu thị có mã lệch, gộp vào 1 email duy nhất', async () => {
    const store = {};
    const { groupReconDigestRowsByRecipient, cleanup } = requireFreshReconDigestJob(store);
    try {
      const uAll = userOf('uall', 'Văn Phòng', { shelfReportView: { all: true } });
      const rowsByDept = new Map([
        ['Siêu thị Quận 1', [{ dept: 'Siêu thị Quận 1', maHang: 'SP001', diff: -5 }]],
        ['Siêu thị Quận 7', [{ dept: 'Siêu thị Quận 7', maHang: 'SP002', diff: 3 }]]
      ]);
      const groups = groupReconDigestRowsByRecipient(['Siêu thị Quận 1', 'Siêu thị Quận 7'], [uAll], {}, rowsByDept);
      assert.strictEqual(groups.length, 1, 'phải gộp thành 1 email duy nhất, không gửi 2 lần');
      assert.strictEqual(groups[0].rows.length, 2);
    } finally { cleanup(); }
  });

  await test('Người nhận "tự thêm thêm" (shelfReconExtraRecipients[dept]) nhận đúng mã lệch của siêu thị mình', async () => {
    const store = {};
    const { groupReconDigestRowsByRecipient, cleanup } = requireFreshReconDigestJob(store);
    try {
      const uExtra = userOf('nv2', 'Siêu thị Quận 1', {}); // không có quyền gì đặc biệt, chỉ nhờ "tự thêm thêm"
      const rowsByDept = new Map([['Siêu thị Quận 1', [{ dept: 'Siêu thị Quận 1', maHang: 'SP001', diff: -5 }]]]);
      const groups = groupReconDigestRowsByRecipient(['Siêu thị Quận 1'], [uExtra], { 'Siêu thị Quận 1': ['nv2'] }, rowsByDept);
      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0].email, 'nv2@x.com');
    } finally { cleanup(); }
  });

  await test('"Tự thêm thêm" của siêu thị KHÁC không được lẫn qua (chỉ áp dụng đúng dept trong map)', async () => {
    const store = {};
    const { groupReconDigestRowsByRecipient, cleanup } = requireFreshReconDigestJob(store);
    try {
      const uExtra = userOf('nv2', 'Siêu thị Quận 1', {});
      const rowsByDept = new Map([['Siêu thị Quận 1', [{ dept: 'Siêu thị Quận 1', maHang: 'SP001', diff: -5 }]]]);
      // nv2 chỉ được thêm cho "Siêu thị Quận 7" (dept KHÁC dept thật của nv2) -> không match Tier1-3, và
      // "Siêu thị Quận 7" không nằm trong deptsWithMaDiem truyền vào -> nv2 không nhận gì.
      const groups = groupReconDigestRowsByRecipient(['Siêu thị Quận 1'], [uExtra], { 'Siêu thị Quận 7': ['nv2'] }, rowsByDept);
      assert.strictEqual(groups.length, 0, 'nv2 không thuộc danh sách tự thêm của ĐÚNG Siêu thị Quận 1 -> không nhận gì');
    } finally { cleanup(); }
  });

  await test('Siêu thị không có mã lệch nào (rowsByDept không có entry) -> không ai thuộc siêu thị đó nhận email', async () => {
    const store = {};
    const { groupReconDigestRowsByRecipient, cleanup } = requireFreshReconDigestJob(store);
    try {
      const u1 = userOf('u1', 'Siêu thị Quận 1', { shelfLocationManage: true });
      const groups = groupReconDigestRowsByRecipient(['Siêu thị Quận 1'], [u1], {}, new Map());
      assert.strictEqual(groups.length, 0, 'không có mã lệch -> không gửi gì, không phải lỗi');
    } finally { cleanup(); }
  });

  await test('User inactive hoặc không có email -> bị loại, không crash', async () => {
    const store = {};
    const { groupReconDigestRowsByRecipient, cleanup } = requireFreshReconDigestJob(store);
    try {
      const uInactive = { ...userOf('u1', 'Siêu thị Quận 1', { shelfLocationManage: true }), active: false };
      const uNoEmail = { ...userOf('u2', 'Siêu thị Quận 1', { shelfLocationManage: true }), email: '' };
      const rowsByDept = new Map([['Siêu thị Quận 1', [{ dept: 'Siêu thị Quận 1', maHang: 'SP001', diff: -5 }]]]);
      const groups = groupReconDigestRowsByRecipient(['Siêu thị Quận 1'], [uInactive, uNoEmail], {}, rowsByDept);
      assert.strictEqual(groups.length, 0);
    } finally { cleanup(); }
  });

  await test('Dedup email không phân biệt hoa/thường — 2 tài khoản cùng email khác hoa/thường chỉ gộp 1 người nhận', async () => {
    const store = {};
    const { groupReconDigestRowsByRecipient, cleanup } = requireFreshReconDigestJob(store);
    try {
      const u1 = { ...userOf('u1', 'Siêu thị Quận 1', { shelfLocationManage: true }), email: 'Boss@X.com' };
      const u2 = { ...userOf('u2', 'Siêu thị Quận 1', { shelfReportView: { depts: ['Siêu thị Quận 1'] } }), email: 'boss@x.com' };
      const rowsByDept = new Map([['Siêu thị Quận 1', [{ dept: 'Siêu thị Quận 1', maHang: 'SP001', diff: -5 }]]]);
      const groups = groupReconDigestRowsByRecipient(['Siêu thị Quận 1'], [u1, u2], {}, rowsByDept);
      assert.strictEqual(groups.length, 1, '2 email chỉ khác hoa/thường phải gộp thành 1 người nhận');
    } finally { cleanup(); }
  });

  console.log('\n== lib/shelfReconDigestExcel.js ==');

  await test('buildShelfReconDigestExcelBuffer: tạo được workbook không lỗi, kể cả rows rỗng', async () => {
    const buf1 = await buildShelfReconDigestExcelBuffer([{ dept: 'Siêu thị Quận 1', maHang: 'SP001', tenHang: 'Bánh', soLuongTon: 30, shelfTotal: 25, diff: -5 }]);
    assert.ok(buf1 && buf1.byteLength > 0, 'phải tạo ra buffer có nội dung');
    const buf2 = await buildShelfReconDigestExcelBuffer([]);
    assert.ok(buf2 && buf2.byteLength > 0, 'rows rỗng vẫn phải tạo được file (không throw)');
  });

  console.log('\n== lib/createValidation.js — assertShelfReconDigestScheduleSafeToSave() ==');

  await test('Cấu hình hợp lệ (WEEKLY) -> không throw', async () => {
    assertShelfReconDigestScheduleSafeToSave({ frequency: 'WEEKLY', hour: 20, dayOfWeek: 1, dayOfMonth: 1, lastSentPeriodKey: null });
  });
  await test('frequency lạ -> throw 400', async () => {
    assert.throws(() => assertShelfReconDigestScheduleSafeToSave({ frequency: 'YEARLY', hour: 20, dayOfWeek: 1, dayOfMonth: 1 }), /Chu kỳ gửi không hợp lệ/);
  });
  await test('hour ngoài 0-23 -> throw 400', async () => {
    assert.throws(() => assertShelfReconDigestScheduleSafeToSave({ frequency: 'DAILY', hour: 25, dayOfWeek: 1, dayOfMonth: 1 }), /Giờ gửi không hợp lệ/);
  });
  await test('value không phải object -> throw, nêu đúng tên "Đối Chiếu" (không lẫn thông báo Ngưỡng Tồn)', async () => {
    assert.throws(() => assertShelfReconDigestScheduleSafeToSave(null), /Đối Chiếu/);
  });

  console.log('\n== routes/shelfStock.js — guard: /recon-recipients dept-scoped, không ghi đè nguyên map ==');

  await test('Route PUT /recon-recipients dùng withLockedAppDataValue (không setAppDataValue/POST /api/data thẳng toàn map)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'shelfStock.js'), 'utf8');
    const start = src.indexOf("router.put('/recon-recipients'");
    const end = src.indexOf('\n});', start);
    assert.ok(start !== -1, 'không tìm thấy route PUT /recon-recipients');
    const handlerSrc = src.slice(start, end);
    assert.ok(handlerSrc.includes('withLockedAppDataValue'), 'phải dùng withLockedAppDataValue để chỉ sửa đúng 1 khoá = dept người gọi');
    assert.ok(handlerSrc.includes('canManageShelfStock'), 'phải gác quyền canManageShelfStock (shelfLocationManage/admin)');
    assert.ok(handlerSrc.includes('req.freshUser.dept'), 'phải tự tra theo req.freshUser.dept, không tin dept client gửi');
    assert.ok(/u\.dept\s*!==\s*req\.freshUser\.dept/.test(handlerSrc), 'phải đối chiếu user được chọn ĐÚNG dept người gọi (chặn chọn nhân viên siêu thị khác)');
  });

  console.log('\n== routes/data.js — guard: shelfReconExtraRecipients bị chặn khỏi route generic + không lộ qua bulk GET ==');

  await test('shelfReconExtraRecipients nằm trong SENSITIVE_KEYS_BLOCKED_FROM_GENERIC_DATA_ROUTE', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'data.js'), 'utf8');
    const start = src.indexOf('const SENSITIVE_KEYS_BLOCKED_FROM_GENERIC_DATA_ROUTE');
    const end = src.indexOf(']);', start);
    const blockSrc = src.slice(start, end);
    assert.ok(blockSrc.includes("'shelfReconExtraRecipients'"), 'phải bị chặn khỏi route generic POST/GET /api/data/:key');
  });

  await test('Bulk GET /api/data luôn strip data.shelfReconExtraRecipients về {} (không lộ map đầy đủ mọi siêu thị)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'data.js'), 'utf8');
    assert.ok(/data\.shelfReconExtraRecipients\s*=\s*\{\}/.test(src), 'phải luôn strip về {} trong payload chung, mỗi siêu thị đọc riêng qua GET /api/shelf-stock/recon-recipients');
  });

  await test('shelfReconDigestSchedule nằm trong ADMIN_ONLY_KEYS (chỉ admin sửa lịch gửi)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'data.js'), 'utf8');
    const start = src.indexOf('const ADMIN_ONLY_KEYS = new Set([');
    const end = src.indexOf('\n]);', start);
    const blockSrc = src.slice(start, end);
    assert.ok(blockSrc.includes("'shelfReconDigestSchedule'"), 'phải admin-only, cùng mức shelfThresholdDigestSchedule');
  });

  console.log(`\n==== ${passed}/${passed + failed} scenario(s) passed ====`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => { console.error('FATAL:', (e && e.stack) || e); process.exitCode = 1; });
