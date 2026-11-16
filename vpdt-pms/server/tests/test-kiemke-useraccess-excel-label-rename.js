// tests/test-kiemke-useraccess-excel-label-rename.js
//
// LOI DA VA (12/2026, theo yeu cau nguoi dung): cot "Ma Nhan Vien" trong file mau Tai Muc "Cau Hinh
// Nguoi Dung" (Tab 8, module Kiem Ke) thuc ra nhan USERNAME dang nhap - trung nhan voi "Ma Nhan Vien"
// o Nhap Excel Gan Chuc Vu (Ho So Nhan Su, BL####), de gay nham lan giua 2 tinh nang. Doi nhan cot
// thanh "Tai Khoan Dang Nhap" - GIU LAI nhan diem header CU ("Ma Nhan Vien") de khong pha file mau/CSV
// da tai xuong truoc khi doi nhan.
//
// Chay: node tests/test-kiemke-useraccess-excel-label-rename.js
'use strict';
const assert = require('assert');
const { buildKiemKeUserAccessTemplateWorkbook, parseKiemKeUserAccessImportFile } = require('../lib/kiemKeUserAccessExcel');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`PASS: ${name}`); }
  catch (err) { fail++; console.log(`FAIL: ${name}\n  -> ${err.message}`); }
}

const ctx = {
  allStores: ['Siêu thị Quận 1'],
  validUsernames: new Set(['nv1']),
  shelfLocations: [{ id: 1, dept: 'Siêu thị Quận 1', code: 'A1' }]
};

function buildMinimalWorkbook(usernameHeader, rows) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Gán Quyền');
  sheet.columns = [
    { header: usernameHeader, key: 'username' }, { header: 'Siêu Thị', key: 'dept' },
    { header: 'Mã Quầy Kệ', key: 'shelfCode' }, { header: 'Gom Mã (x)', key: 'gomMa' },
    { header: 'Kiểm Đếm (x)', key: 'kiemDem' }, { header: 'Kiểm Soát (x)', key: 'kiemSoat' }
  ];
  rows.forEach(r => sheet.addRow(r));
  return wb;
}

async function main() {
  await test('Header mẫu MỚI là "Tài Khoản Đăng Nhập" (không còn "Mã Nhân Viên")', async () => {
    const wb = buildKiemKeUserAccessTemplateWorkbook(['Siêu thị Quận 1']);
    const header = wb.getWorksheet('Gán Quyền').getRow(1).getCell(1).value;
    assert.strictEqual(header, 'Tài Khoản Đăng Nhập');
  });

  await test('Parse file dùng ĐÚNG mẫu mới -> đọc đúng username từ cột "Tài Khoản Đăng Nhập"', async () => {
    const wb = buildMinimalWorkbook('Tài Khoản Đăng Nhập', [
      { username: 'nv1', dept: 'Siêu thị Quận 1', shelfCode: 'A1', gomMa: 'x', kiemDem: '', kiemSoat: '' }
    ]);
    const buffer = await wb.xlsx.writeBuffer();
    const items = await parseKiemKeUserAccessImportFile(buffer, '.xlsx', ctx);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].username, 'nv1');
    assert.strictEqual(items[0].valid, true);
  });

  await test('Tương thích ngược: file CŨ còn header "Mã Nhân Viên" (tải trước khi đổi nhãn) vẫn đọc được', async () => {
    const wb = buildMinimalWorkbook('Mã Nhân Viên', [
      { username: 'nv1', dept: 'Siêu thị Quận 1', shelfCode: 'A1', gomMa: 'x', kiemDem: '', kiemSoat: '' }
    ]);
    const buffer = await wb.xlsx.writeBuffer();
    const items = await parseKiemKeUserAccessImportFile(buffer, '.xlsx', ctx);
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].username, 'nv1');
    assert.strictEqual(items[0].valid, true);
  });

  await test('Thông báo lỗi dùng nhãn MỚI "Tài Khoản Đăng Nhập" khi username không hợp lệ', async () => {
    const wb = buildMinimalWorkbook('Tài Khoản Đăng Nhập', [
      { username: 'khong_ton_tai', dept: 'Siêu thị Quận 1', shelfCode: 'A1', gomMa: 'x', kiemDem: '', kiemSoat: '' }
    ]);
    const buffer = await wb.xlsx.writeBuffer();
    const items = await parseKiemKeUserAccessImportFile(buffer, '.xlsx', ctx);
    assert.strictEqual(items[0].valid, false);
    assert.ok(items[0].errors.some(e => e.includes('Tài Khoản Đăng Nhập')), `Lỗi phải nhắc đúng nhãn mới: ${JSON.stringify(items[0].errors)}`);
  });

  console.log(`\n${pass}/${pass + fail} scenario(s) passed.`);
  process.exitCode = fail ? 1 : 0;
}

main().catch((err) => { console.error('FATAL:', err.stack || err); process.exitCode = 1; });
