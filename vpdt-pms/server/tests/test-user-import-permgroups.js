// server/tests/test-user-import-permgroups.js
//
// Regression test cho Fix TB-4 (rà soát chuyên sâu 4-agent song song, 9/2026): trước đây bulk import
// Excel người dùng KHÔNG có cách nào gán "Nhóm Phân Quyền" — mọi user tạo qua import luôn rơi về
// defaultNewUserPerms() (an toàn nhưng khác hẳn tạo tay, admin phải tự sửa lại từng người sau khi
// import). Đã vá: thêm cột "permgroups" (TÊN nhóm, phân tách ";") vào USER_IMPORT_COLUMNS
// (lib/adminExport.js) + validateImportedUserRow()/confirmUsersImport() (module-admin-userstaging.js)
// tự dò tên -> id khớp DB.permGroups, tính perms = mergeGroupsBasePerms() giống hệt tạo tay
// (readUserFormState(), module-admin-submissiongroups.js).
//
// Test này lái THẲNG các hàm client thật (validateImportedUserRow/confirmUsersImport) qua Playwright,
// KHÔNG cần server thật (chỉ stub window.fetch trả về 200 cho syncStorage(), vì mục tiêu là xác nhận
// đúng LOGIC PHÍA CLIENT — server-side validation của mảng users đã có test riêng
// test-user-import-login-e2e.js).
//
// Chạy: node server/tests/test-user-import-permgroups.js
'use strict';
const { startStaticServer, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const server = await startStaticServer();
  const port = server.address().port;
  const { browser, page } = await launchPage(port, {});
  const run = createRunner();

  try {
    await page.evaluate(() => {
      DB.permGroups = [
        { id: 1, name: 'Kế Toán', perms: { paymentManage: true, admin: false } },
        { id: 2, name: 'Quản Lý Kho', perms: { officeBuy: true } }
      ];
      DB.users = [{ id: 1, username: 'admin', name: 'Admin', perms: { admin: true } }];
      DB.depts = ['Phòng Kế Toán'];
      DB.positionTypes = [{ key: 'HO', label: 'Hành Chính' }, { key: 'STORE', label: 'Siêu Thị' }];
      DB.stores = [];
      DB.jobTitles = [];
      DB.storeJobTitles = [];
      DB.deptGroups = [];
      window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
    });

    await run.run('validateImportedUserRow(): tên nhóm hợp lệ (1 nhóm) -> groupIds đúng, không lỗi', async () => {
      const result = await page.evaluate(() => validateImportedUserRow({
        posType: 'HO', dept: 'Phòng Kế Toán', jobTitle: '', khoiBan: '', startDate: '', permGroups: 'Kế Toán'
      }));
      assertEqual(result.errors.length, 0, JSON.stringify(result.errors));
      assertEqual(JSON.stringify(result.normalized.groupIds), JSON.stringify([1]));
    });

    await run.run('validateImportedUserRow(): nhiều nhóm phân tách ";" -> groupIds đủ cả 2', async () => {
      const result = await page.evaluate(() => validateImportedUserRow({
        posType: 'HO', dept: 'Phòng Kế Toán', jobTitle: '', khoiBan: '', startDate: '', permGroups: 'Kế Toán;Quản Lý Kho'
      }));
      assertEqual(result.errors.length, 0, JSON.stringify(result.errors));
      assertEqual(JSON.stringify(result.normalized.groupIds.sort()), JSON.stringify([1, 2]));
    });

    await run.run('validateImportedUserRow(): để trống permgroups -> groupIds rỗng, hợp lệ (không lỗi)', async () => {
      const result = await page.evaluate(() => validateImportedUserRow({
        posType: 'HO', dept: 'Phòng Kế Toán', jobTitle: '', khoiBan: '', startDate: '', permGroups: ''
      }));
      assertEqual(result.errors.length, 0, JSON.stringify(result.errors));
      assertEqual(JSON.stringify(result.normalized.groupIds), JSON.stringify([]));
    });

    await run.run('validateImportedUserRow(): tên nhóm KHÔNG khớp danh mục -> báo lỗi rõ ràng, chặn dòng', async () => {
      const result = await page.evaluate(() => validateImportedUserRow({
        posType: 'HO', dept: 'Phòng Kế Toán', jobTitle: '', khoiBan: '', startDate: '', permGroups: 'Nhóm Không Tồn Tại'
      }));
      assert(result.errors.some(e => e.includes('Nhóm Không Tồn Tại')), JSON.stringify(result.errors));
    });

    await run.run('confirmUsersImport(): user MỚI có gán nhóm -> perms = mergeGroupsBasePerms() của nhóm đó, groupIds lưu đúng', async () => {
      const pushedUser = await page.evaluate(async () => {
        usersImportPreviewItems = [{
          _idx: 0, username: 'ketoan1', pass: 'MatKhau@2024', name: 'Kế Toán Một', email: '', phone: '',
          errors: [], duplicateInFile: false, duplicateExisting: false, action: 'add',
          normalized: { posType: 'HO', dept: 'Phòng Kế Toán', jobTitle: '', startDate: '', khoiBan: '', groupIds: [1] }
        }];
        await confirmUsersImport();
        return DB.users.find(u => u.username === 'ketoan1');
      });
      assert(!!pushedUser, 'Không tìm thấy user vừa import');
      assertEqual(JSON.stringify(pushedUser.groupIds), JSON.stringify([1]));
      assertEqual(pushedUser.perms.paymentManage, true, JSON.stringify(pushedUser.perms));
    });

    await run.run('confirmUsersImport(): user MỚI KHÔNG gán nhóm -> vẫn dùng defaultNewUserPerms() như hành vi cũ (an toàn)', async () => {
      const pushedUser = await page.evaluate(async () => {
        usersImportPreviewItems = [{
          _idx: 0, username: 'nhanvien1', pass: 'MatKhau@2024', name: 'Nhân Viên Một', email: '', phone: '',
          errors: [], duplicateInFile: false, duplicateExisting: false, action: 'add',
          normalized: { posType: 'HO', dept: 'Phòng Kế Toán', jobTitle: '', startDate: '', khoiBan: '', groupIds: [] }
        }];
        await confirmUsersImport();
        return DB.users.find(u => u.username === 'nhanvien1');
      });
      assert(!!pushedUser, 'Không tìm thấy user vừa import');
      assertEqual(JSON.stringify(pushedUser.groupIds), JSON.stringify([]));
      // defaultNewUserPerms() không có paymentManage:true (khác nhóm "Kế Toán" ở test trên) — xác nhận
      // KHÔNG bị lây quyền từ nhóm nào dù DB.permGroups đã seed sẵn cả 2 nhóm.
      assertEqual(pushedUser.perms.paymentManage, false, JSON.stringify(pushedUser.perms));
      assertEqual(pushedUser.perms.admin, false, JSON.stringify(pushedUser.perms));
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
