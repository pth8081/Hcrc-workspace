// server/tests/test-user-import-inline-fix.js
//
// Regression test cho tính năng "sửa ngay trong dòng lỗi" (10/2026, yêu cầu người dùng: "import 100
// dòng chỉ 1 dòng lỗi, cho tôi sửa luôn tại chỗ — department sai thì chọn lại đúng trong danh mục,
// SĐT/email sai thì gõ lại — không phải huỷ nhập lại cả file"). Xem renderUserImportFixRow()/
// onUsersImportRowFieldEdit() (module-admin-userstaging.js).
//
// Chạy: node server/tests/test-user-import-inline-fix.js
'use strict';
const { startStaticServer, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

async function main() {
  const server = await startStaticServer();
  const port = server.address().port;
  const { browser, page } = await launchPage(port, {});
  const run = createRunner();

  try {
    await page.evaluate(() => {
      window.alert = () => {};
      window.confirm = () => true;
      window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
      DB.permGroups = [];
      DB.users = [
        { id: 1, username: 'admin', name: 'Admin', perms: { admin: true } },
        { id: 2, username: 'nv.cu', name: 'Nhân Viên Cũ', dept: 'Kế Toán', posType: 'HO', perms: {} },
      ];
      DB.depts = ['Kế Toán', 'Kinh Doanh'];
      DB.stores = ['Siêu Thị Quận 1'];
      DB.positionTypes = [{ key: 'HO', label: 'HO (Văn phòng)' }, { key: 'STORE', label: 'Siêu Thị' }];
      DB.jobTitles = ['Nhân viên'];
      DB.storeJobTitles = [];
      DB.deptGroups = [];
    });

    await run.run('Dòng lỗi (dept sai): renderUserImportFixRow() vẽ đủ ô sửa, dept là <select> đúng danh mục', async () => {
      const r = await page.evaluate(async () => {
        const savedFetch = window.fetch;
        window.fetch = async (url, opts) => {
          if (url === '/api/admin/users/import-xlsx') {
            return { ok: true, status: 200, json: async () => ({ rows: [
              { username: 'nv.baddept', pass: 'Passw0rd!23', name: 'Sai Phòng Ban', email: 'bad@hcrc.local', phone: '0900000001', dept: 'Phòng Ma', jobTitle: '', posType: 'HO', startDate: '', duplicateInFile: false },
            ] }) };
          }
          return savedFetch(url, opts);
        };
        await onUsersImportFileChange({ target: { files: [new File(['x'], 'test.xlsx')], value: '' } });
        window.fetch = savedFetch;
        const deptSelect = document.querySelector('#uImportPreviewBody select[data-arg1="dept"]');
        const passInput = document.querySelector('#uImportPreviewBody input[data-arg1="pass"]');
        return {
          hasErrorNow: usersImportPreviewItems[0].errors.length > 0,
          deptSelectExists: !!deptSelect,
          deptOptions: deptSelect ? [...deptSelect.options].map(o => o.value) : [],
          passInputExists: !!passInput,
        };
      });
      assert(r.hasErrorNow, 'Dòng phải đang lỗi (dept không có trong danh mục)');
      assert(r.deptSelectExists, 'Phải có <select> cho field dept trong khung sửa');
      assert(r.deptOptions.includes('Kế Toán') && r.deptOptions.includes('Kinh Doanh'), 'Dropdown dept phải liệt kê đúng DB.depts: ' + JSON.stringify(r.deptOptions));
      assert(r.passInputExists, 'Dòng TẠO MỚI (không trùng username) phải có ô Mật Khẩu để sửa');
    });

    await run.run('onUsersImportRowFieldEdit(): chọn lại dept hợp lệ -> hết lỗi, tự chuyển action="add"', async () => {
      const r = await page.evaluate(() => {
        onUsersImportRowFieldEdit(0, 'dept', 'Kinh Doanh');
        const it = usersImportPreviewItems[0];
        return { errors: it.errors, action: it.action, normalizedDept: it.normalized.dept };
      });
      assertEqual(r.errors.length, 0, 'Phải hết lỗi sau khi chọn đúng Phòng Ban: ' + JSON.stringify(r.errors));
      assertEqual(r.action, 'add', 'Phải tự chuyển sang action="add" (dòng mới, không trùng)');
      assertEqual(r.normalizedDept, 'Kinh Doanh');
    });

    await run.run('onUsersImportRowFieldEdit(): sửa thêm email/phone/name -> lưu đúng giá trị mới trên dòng', async () => {
      const r = await page.evaluate(() => {
        onUsersImportRowFieldEdit(0, 'email', 'sua-lai@hcrc.local');
        onUsersImportRowFieldEdit(0, 'phone', '0911223344');
        onUsersImportRowFieldEdit(0, 'name', 'Tên Đã Sửa');
        const it = usersImportPreviewItems[0];
        return { email: it.email, phone: it.phone, name: it.name, stillNoError: it.errors.length === 0 };
      });
      assertEqual(r.email, 'sua-lai@hcrc.local');
      assertEqual(r.phone, '0911223344');
      assertEqual(r.name, 'Tên Đã Sửa');
      assert(r.stillNoError, 'Sửa email/phone/name không được tự sinh lỗi mới');
    });

    await run.run('confirmUsersImport(): dòng đã sửa xong -> tạo được user với đúng dữ liệu đã sửa', async () => {
      const r = await page.evaluate(async () => {
        const before = DB.users.length;
        await confirmUsersImport();
        const created = DB.users.find(u => u.username === 'nv.baddept');
        return { createdCount: DB.users.length - before, created };
      });
      assertEqual(r.createdCount, 1, 'Phải tạo đúng 1 user mới');
      assert(!!r.created, 'Không tìm thấy user vừa tạo');
      assertEqual(r.created.dept, 'Kinh Doanh');
      assertEqual(r.created.email, 'sua-lai@hcrc.local');
      assertEqual(r.created.phone, '0911223344');
      assertEqual(r.created.name, 'Tên Đã Sửa');
    });

    await run.run('Dòng GHI ĐÈ (username trùng tài khoản có sẵn) có lỗi -> khung sửa KHÔNG có ô Mật Khẩu, sửa xong action trở về "skip" (không tự "add")', async () => {
      const r = await page.evaluate(async () => {
        const savedFetch = window.fetch;
        window.fetch = async (url, opts) => {
          if (url === '/api/admin/users/import-xlsx') {
            return { ok: true, status: 200, json: async () => ({ rows: [
              { username: 'nv.cu', pass: '', name: 'Nhân Viên Cũ Sửa', email: '', phone: '', dept: 'Phòng Ma Khác', jobTitle: '', posType: 'HO', startDate: '', duplicateInFile: false },
            ] }) };
          }
          return savedFetch(url, opts);
        };
        await onUsersImportFileChange({ target: { files: [new File(['x'], 'test2.xlsx')], value: '' } });
        window.fetch = savedFetch;
        const passInputBefore = document.querySelector('#uImportPreviewBody input[data-arg1="pass"]');
        onUsersImportRowFieldEdit(0, 'dept', 'Kinh Doanh');
        const it = usersImportPreviewItems[0];
        return { passInputExistedBefore: !!passInputBefore, errorsAfter: it.errors, actionAfter: it.action, duplicateExisting: it.duplicateExisting };
      });
      assert(r.duplicateExisting, 'Dòng phải được nhận diện đúng là username trùng tài khoản có sẵn');
      assert(!r.passInputExistedBefore, 'Dòng ghi đè (duplicateExisting) KHÔNG được có ô Mật Khẩu trong khung sửa (không bao giờ đụng mật khẩu tài khoản cũ)');
      assertEqual(r.errorsAfter.length, 0, 'Phải hết lỗi sau khi sửa dept: ' + JSON.stringify(r.errorsAfter));
      assertEqual(r.actionAfter, 'skip', 'Dòng trùng username vẫn mặc định "Bỏ qua" sau khi hết lỗi (khớp hành vi gốc, không tự ý ghi đè)');
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
