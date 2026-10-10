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
      // finishLogin() PHẢI gọi để các kịch bản dùng switchTab()/setAdminSubTab() (thao tác DOM thật phía
      // dưới) thấy đúng giao diện chính (trước khi đăng nhập, #systemSection nằm trong khối còn "hidden"
      // của màn đăng nhập — switchTab() không tự hiện lại được nếu bỏ qua bước này).
      finishLogin(DB.users[0]);
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

    // Toàn bộ kịch bản trên gọi onUsersImportRowFieldEdit() TRỰC TIẾP qua page.evaluate() — chưa chứng
    // minh cơ chế CSP (data-op-input/data-op-change + bindCspDelegation('systemSection')) THẬT SỰ bắt
    // được sự kiện gõ/chọn thật trên các ô vừa thêm. Đây là phần dây nối MỚI duy nhất trong cả tính năng
    // (phần logic validate/confirm đã tái dùng nguyên hàm cũ) — người dùng yêu cầu test thật kỹ, nên bọc
    // thêm đúng 1 kịch bản dùng page.selectOption()/page.fill() (thao tác DOM THẬT, giống người dùng bấm
    // chuột/gõ phím) thay vì gọi thẳng hàm JS, để loại trừ khả năng data-arg0/data-arg1/data-arg-value
    // gắn sai vị trí (lỗi kiểu này KHÔNG thể phát hiện nếu chỉ gọi hàm trực tiếp).
    await run.run('[Thao tác DOM THẬT] chọn lại Phòng Ban qua <select> thật (page.selectOption) + gõ lại Email/SĐT qua ô input thật (page.fill) -> CSP dispatch đúng, hết lỗi, action tự "add"', async () => {
      const r = await page.evaluate(async () => {
        // Phải THẬT SỰ chuyển vào đúng tab/sub-tab trước — #uImportPreviewWrap nằm trong
        // #systemSection/sub-tab Phân Quyền, nếu không mở tab này trước thì cha của nó vẫn còn class
        // "hidden" (CSS display:none) khiến Playwright coi mọi phần tử bên trong là "hidden", không thể
        // selectOption()/fill() thật (đúng hành vi an toàn của Playwright — không click/gõ vào phần tử
        // không hiển thị cho người dùng thật).
        await switchTab('system');
        if (typeof setAdminSubTab === 'function') setAdminSubTab('PERMS');
        const savedFetch = window.fetch;
        window.fetch = async (url, opts) => {
          if (url === '/api/admin/users/import-xlsx') {
            return { ok: true, status: 200, json: async () => ({ rows: [
              { username: 'nv.realdom', pass: 'Passw0rd!23', name: 'Thao Tác Thật', email: 'cu@hcrc.local', phone: '0900000000', dept: 'Phòng Ma Thật', jobTitle: '', posType: 'HO', startDate: '', duplicateInFile: false },
            ] }) };
          }
          return savedFetch(url, opts);
        };
        await onUsersImportFileChange({ target: { files: [new File(['x'], 'test3.xlsx')], value: '' } });
        window.fetch = savedFetch;
      });

      // QUAN TRỌNG: khung sửa (renderUserImportFixRow) CHỈ hiển thị khi dòng còn lỗi (hasError) — dòng
      // này chỉ lỗi ở "dept", nên phải gõ Email/SĐT TRƯỚC (lúc khung sửa còn hiển thị do dept vẫn sai),
      // rồi mới chọn lại dept SAU CÙNG (hết lỗi -> renderUsersImportPreview() vẽ lại, khung sửa biến
      // mất) — nếu làm ngược lại (sửa dept trước) thì sau khi re-render, select/input Email/SĐT cũ đã bị
      // gỡ khỏi DOM, page.fill() vào đúng selector sẽ treo chờ phần tử không bao giờ xuất hiện lại.
      const emailSelector = '#uImportPreviewBody input[data-arg1="email"]';
      const phoneSelector = '#uImportPreviewBody input[data-arg1="phone"]';
      await page.waitForSelector(emailSelector);
      await page.fill(emailSelector, 'that-su-da-sua@hcrc.local');
      await page.fill(phoneSelector, '0977888999');

      // Xác nhận select dept đang lỗi + option "Kinh Doanh" tồn tại, rồi CHỌN THẬT qua Playwright (sau
      // cùng, vì thao tác này xoá lỗi duy nhất của dòng và làm khung sửa biến mất).
      const deptSelector = '#uImportPreviewBody select[data-arg1="dept"]';
      await page.selectOption(deptSelector, { label: 'Kinh Doanh' });

      const r2 = await page.evaluate(() => {
        const it = usersImportPreviewItems.find(x => x.username === 'nv.realdom');
        return { errors: it.errors, action: it.action, dept: it.dept, normalizedDept: it.normalized.dept, email: it.email, phone: it.phone };
      });
      assertEqual(r2.errors.length, 0, 'Thao tác DOM thật (chọn dept) phải khiến CSP dispatch gọi đúng onUsersImportRowFieldEdit() và hết lỗi: ' + JSON.stringify(r2));
      assertEqual(r2.action, 'add', 'Phải tự chuyển action="add" sau khi dept hợp lệ qua thao tác thật');
      assertEqual(r2.normalizedDept, 'Kinh Doanh');
      assertEqual(r2.email, 'that-su-da-sua@hcrc.local', 'Ô Email gõ thật phải cập nhật đúng giá trị qua data-op-input');
      assertEqual(r2.phone, '0977888999', 'Ô SĐT gõ thật phải cập nhật đúng giá trị qua data-op-input');

      // Xác nhận cuối: confirmUsersImport() thật sự tạo được user với dữ liệu đã sửa qua thao tác DOM.
      const r3 = await page.evaluate(async () => {
        const before = DB.users.length;
        await confirmUsersImport();
        return { createdCount: DB.users.length - before, created: DB.users.find(u => u.username === 'nv.realdom') };
      });
      assertEqual(r3.createdCount, 1);
      assert(!!r3.created);
      assertEqual(r3.created.dept, 'Kinh Doanh');
      assertEqual(r3.created.email, 'that-su-da-sua@hcrc.local');
      assertEqual(r3.created.phone, '0977888999');
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
