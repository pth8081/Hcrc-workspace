// server/tests/test-hr-profile-import-whitespace-strip.js
//
// LỖI ĐÃ VÁ (11/2026, theo yêu cầu người dùng: "khi import file vào ấy, thì cắt luôn dấu trắng đi để nó
// luôn liền mã và số... đảm bảo không bao giờ sai"): Nhập Excel Hồ Sơ Nhân Sự trước đây chỉ trim() 2 đầu
// Mã Nhân Viên/Tài Khoản VPDT — khoảng trắng dính Ở GIỮA (VD "BL 3883" dán từ nguồn khác/gõ nhầm phím
// cách) lọt qua nguyên vẹn, khiến hồ sơ không khớp được employeeCode/username thật ở bất kỳ đối chiếu
// nào khác (Mã NV ↔ Tài Khoản, Liên Kết Tài Khoản, Gán Chức Vụ...). Nay rowToPreviewItem()
// (lib/employeeProfileImport.js) cắt TOÀN BỘ khoảng trắng (đầu/cuối/giữa) cho đúng 2 field định danh
// này — các field tự do khác (Họ Tên...) KHÔNG đổi, vẫn trim() 2 đầu như cũ.
//
// Chạy: node server/tests/test-hr-profile-import-whitespace-strip.js
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
  sheet.spliceRows(2, 1);
  rows.forEach(r => sheet.addRow(r));
  return wb.xlsx.writeBuffer();
}

async function main() {
  console.log('== test-hr-profile-import-whitespace-strip.js ==');

  await test('Mã Nhân Viên dính khoảng trắng Ở GIỮA ("BL 3883") -> cắt sạch thành "BL3883", không còn khoảng trắng nào', async () => {
    const buffer = await buildBufferWithRows([{ employeeCode: 'BL 3883', username: '' }]);
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], []);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].employeeCode, 'BL3883', `phải cắt sạch khoảng trắng giữa, thực tế: "${items[0].employeeCode}"`);
  });

  await test('Mã Nhân Viên dính khoảng trắng ĐẦU/CUỐI/GIỮA cùng lúc ("  BL 38 83  ") -> cắt sạch thành "BL3883"', async () => {
    const buffer = await buildBufferWithRows([{ employeeCode: '  BL 38 83  ', username: '' }]);
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], []);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].employeeCode, 'BL3883');
  });

  await test('Tài Khoản VPDT (cột username) dính khoảng trắng giữa ("BL 3883") -> cắt sạch, khớp ĐÚNG được tài khoản thật "BL3883"', async () => {
    const buffer = await buildBufferWithRows([{ employeeCode: 'BL3883', username: 'BL 3883' }]);
    const users = [{ username: 'BL3883', name: 'Lò Thị Chử', active: true }];
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], users);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].username, 'BL3883', `phải cắt khoảng trắng để khớp đúng tài khoản, thực tế: "${items[0].username}"`);
    assert.strictEqual(items[0].valid, true, JSON.stringify(items[0].errors));
  });

  await test('ĐỐI CHỨNG: Mã Nhân Viên sau khi cắt khoảng trắng trùng với hồ sơ đã có ("BL 3883" vs "BL3883" đã tồn tại) -> vẫn nhận diện ĐÚNG là trùng (duplicateExisting=true)', async () => {
    const buffer = await buildBufferWithRows([{ employeeCode: 'BL 3883', username: '' }]);
    const existingProfiles = [{ employeeCode: 'BL3883', status: 'ACTIVE' }];
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, existingProfiles, []);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].duplicateExisting, true, 'phải nhận ra trùng SAU khi đã cắt khoảng trắng, không bị lọt thành "hồ sơ mới" giả');
  });

  await test('ĐỐI CHỨNG: Địa Chỉ Thường Trú (field tự do, KHÔNG phải định danh) vẫn giữ khoảng trắng ở giữa như cũ, chỉ trim() 2 đầu', async () => {
    const buffer = await buildBufferWithRows([{ employeeCode: 'BL3884', permanentAddress: '  123 Đường  ABC, Q.1  ' }]);
    const items = await employeeProfileImport.parseImportExcelBuffer(buffer, [], []);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].permanentAddress, '123 Đường  ABC, Q.1', 'Địa chỉ chỉ trim() 2 đầu, KHÔNG được đụng khoảng trắng ở giữa (địa chỉ thật cần giữ dấu cách)');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
