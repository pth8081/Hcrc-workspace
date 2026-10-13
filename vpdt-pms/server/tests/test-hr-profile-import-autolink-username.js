// server/tests/test-hr-profile-import-autolink-username.js
//
// Tự động liên kết Tài Khoản VPDT khi Nhập Excel Hồ Sơ Nhân Sự (10/2026, theo yêu cầu người dùng — di
// trú dữ liệu cũ: "mã nv và mã hs như nhau, cái nào không trùng thì chọn tay"). Khi cột "Tài Khoản VPDT"
// bỏ TRỐNG trong Excel, hệ thống tự tìm 1 tài khoản ĐANG HOẠT ĐỘNG có username === Mã Nhân Viên (khớp
// CHÍNH XÁC) và CHƯA liên kết hồ sơ nào khác, tự điền vào — không khớp được thì giữ trống như cũ, HR tự
// "Liên Kết Tài Khoản VPDT" tay sau. Xem rowToPreviewItem() ở lib/employeeProfileImport.js.
//
// Chạy: node server/tests/test-hr-profile-import-autolink-username.js
'use strict';

const path = require('path');
const assert = require('assert');

function stubModule(relPath, exportsObj) {
  const full = require.resolve(path.join(__dirname, '..', relPath));
  require.cache[full] = { id: full, filename: full, path: path.dirname(full), loaded: true, exports: exportsObj, children: [], paths: [] };
  return exportsObj;
}
stubModule('lib/appData', {
  getAppDataValue: async () => null,
  getAllAppData: async () => ({}),
  withLockedAppDataValue: async () => { throw new Error('withLockedAppDataValue không dùng ở test này'); }
});

const employeeProfileImport = require('../lib/employeeProfileImport');
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; console.error(`  ❌ ${name}\n     ${err.message}`); }
}

async function buildBufferWithRows(rows) {
  const wb = await employeeProfileImport.buildImportTemplateWorkbook();
  const sheet = wb.getWorksheet('Hồ Sơ Nhân Sự');
  // LỖI THẬT đã gặp khi viết test này: sheet.rowCount lúc này là 500 (dropdown validation áp tới dòng
  // 500 khiến exceljs vật chất hoá sẵn nhiêu đó dòng "ảo" không có dữ liệu thật), KHÔNG phải 2 như trông
  // đợi — spliceRows(2, sheet.rowCount - 1) không xoá được đúng dòng ví dụ mẫu, khiến dòng "NV1001" ví dụ
  // vẫn lẫn vào kết quả đọc. Đúng cách (cùng khuôn mọi test khác trong repo, xem test-labor-contract-
  // create-import.js/test-hr-process-onboarding-create-import.js): CHỈ xoá đúng 1 dòng ví dụ ở vị trí 2.
  sheet.spliceRows(2, 1);
  rows.forEach(r => sheet.addRow(r));
  return wb.xlsx.writeBuffer();
}

async function main() {
  console.log('== test-hr-profile-import-autolink-username.js ==');

  await test('Cột "Tài Khoản VPDT" BỎ TRỐNG + có tài khoản ĐANG HOẠT ĐỘNG trùng ĐÚNG Mã Nhân Viên -> tự liên kết, đánh dấu autoLinkedUsername=true', async () => {
    const buffer = await buildBufferWithRows([{ employeeCode: 'NV9001', username: '' }]);
    const users = [{ username: 'NV9001', name: 'Nguyễn Văn A', active: true }];
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], users);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].username, 'NV9001', 'phải tự điền đúng username khớp Mã Nhân Viên');
    assert.strictEqual(items[0].autoLinkedUsername, true);
    assert.strictEqual(items[0].valid, true, JSON.stringify(items[0].errors));
  });

  await test('Cột "Tài Khoản VPDT" BỎ TRỐNG + KHÔNG có tài khoản nào trùng Mã Nhân Viên -> giữ nguyên trống, KHÔNG báo lỗi gì (HR tự liên kết tay sau)', async () => {
    const buffer = await buildBufferWithRows([{ employeeCode: 'NV9002', username: '' }]);
    const users = [{ username: 'khac.user', name: 'Người Khác', active: true }];
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], users);
    assert.strictEqual(items[0].username, null);
    assert.strictEqual(items[0].autoLinkedUsername, false);
    assert.strictEqual(items[0].valid, true, JSON.stringify(items[0].errors));
  });

  await test('Tài khoản trùng Mã Nhân Viên nhưng ĐÃ BỊ KHOÁ (active=false) -> KHÔNG tự liên kết (giữ trống)', async () => {
    const buffer = await buildBufferWithRows([{ employeeCode: 'NV9003', username: '' }]);
    const users = [{ username: 'NV9003', name: 'Tài Khoản Đã Khoá', active: false }];
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], users);
    assert.strictEqual(items[0].username, null, 'không được tự liên kết tài khoản đã khoá');
    assert.strictEqual(items[0].autoLinkedUsername, false);
  });

  await test('Tài khoản trùng Mã Nhân Viên nhưng ĐÃ liên kết với 1 hồ sơ KHÁC -> KHÔNG tự liên kết (tránh chiếm tài khoản người khác)', async () => {
    const buffer = await buildBufferWithRows([{ employeeCode: 'NV9004', username: '' }]);
    const users = [{ username: 'NV9004', name: 'Đã Có Chủ', active: true }];
    const existingProfiles = [{ employeeCode: 'NV9999', username: 'NV9004' }]; // hồ sơ KHÁC đã chiếm username này
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, existingProfiles, users);
    assert.strictEqual(items[0].username, null, 'không được tự liên kết tài khoản đã thuộc hồ sơ khác');
    assert.strictEqual(items[0].autoLinkedUsername, false);
  });

  await test('Excel đã TỰ GÕ sẵn 1 giá trị Tài Khoản VPDT KHÁC -> KHÔNG bị ghi đè bởi tự động liên kết (tôn trọng giá trị người dùng gõ)', async () => {
    const buffer = await buildBufferWithRows([{ employeeCode: 'NV9005', username: 'nguoidung.tugo' }]);
    const users = [
      { username: 'NV9005', name: 'Trùng Mã NV', active: true }, // sẽ KHÔNG được chọn vì cột đã có giá trị
      { username: 'nguoidung.tugo', name: 'Người Dùng Tự Gõ', active: true }
    ];
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], users);
    assert.strictEqual(items[0].username, 'nguoidung.tugo', 'phải giữ nguyên giá trị người dùng tự gõ trong Excel');
    assert.strictEqual(items[0].autoLinkedUsername, false, 'KHÔNG đánh dấu tự động vì đây là giá trị người dùng tự gõ');
  });

  await test('2 dòng CÙNG LÚC đều trống Tài Khoản VPDT, mỗi dòng khớp đúng 1 tài khoản RIÊNG theo Mã Nhân Viên -> cả 2 tự liên kết ĐÚNG, không lẫn lộn', async () => {
    const buffer = await buildBufferWithRows([
      { employeeCode: 'NV9006', username: '' },
      { employeeCode: 'NV9007', username: '' }
    ]);
    const users = [
      { username: 'NV9006', name: 'Nhân Viên Sáu', active: true },
      { username: 'NV9007', name: 'Nhân Viên Bảy', active: true }
    ];
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], users);
    assert.strictEqual(items[0].username, 'NV9006');
    assert.strictEqual(items[1].username, 'NV9007');
    assert.ok(items[0].autoLinkedUsername && items[1].autoLinkedUsername);
  });

  console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\n${passed} passed, 0 failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
