// tests/demo-hr-sync-edit-user.js — DEMO ảnh thật (12/2026), theo yêu cầu người dùng kèm ảnh chụp form
// Sửa 1 tài khoản: "tôi đang yêu cầu nếu tôi không nhập thì lấy tự động từ hồ sơ nhân sự hoặc onboarding
// sau giờ chưa tự động? ... cho tôi thêm một chức năng cập nhật ngày vào, email và số điện thoại từ hồ
// sơ nhân sự (nếu trường nào đang trống thì cho phép cập nhật, trường nào có rồi thì phải hỏi để nếu ghi
// đè thì ghi, không thì thôi)" — xem syncHrFieldsOnEditOpen() (module-admin-submissiongroups.js), gọi từ
// editUser() (module-admin-userstaging.js).
// Chạy: node tests/demo-hr-sync-edit-user.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8958;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'hr-sync-edit-user');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const DEPT1 = 'Siêu thị Quận 1';
  const ADMIN = { username: 'admin', name: 'Admin', dept: 'Quản trị', perms: { admin: true, hrProfileManage: true }, active: true, totpEnabled: true };
  // nv.empty — Email/SĐT/Ngày Vào Làm Việc đang TRỐNG trên tài khoản, Hồ Sơ Nhân Sự đã có sẵn đủ cả 3.
  const NV_EMPTY = { id: 101, username: 'nv.empty', name: 'Nguyễn Văn Trống', email: '', phone: '', startDate: '', dept: DEPT1, jobTitle: 'Nhân viên', posType: 'STORE', perms: {}, active: true, totpEnabled: true };
  // nv.conflict — Email/SĐT/Ngày Vào Làm Việc ĐÃ CÓ SẴN nhưng LỆCH với Hồ Sơ Nhân Sự (demo tình huống hỏi
  // trước khi ghi đè) — 2 bản sao CÙNG dữ liệu lệch, 1 bản demo "Đồng ý ghi đè", 1 bản demo "Không ghi đè".
  const NV_CONFLICT_YES = { id: 102, username: 'nv.conflict.yes', name: 'Trần Thị Lệch Một', email: 'cu.khong.dung@gmail.com', phone: '0900000001', startDate: '2020-01-01', dept: DEPT1, jobTitle: 'Nhân viên', posType: 'STORE', perms: {}, active: true, totpEnabled: true };
  const NV_CONFLICT_NO = { id: 103, username: 'nv.conflict.no', name: 'Trần Thị Lệch Hai', email: 'cu.khong.dung2@gmail.com', phone: '0900000002', startDate: '2020-02-02', dept: DEPT1, jobTitle: 'Nhân viên', posType: 'STORE', perms: {}, active: true, totpEnabled: true };

  const state = createMockState({
    depts: ['Quản trị', DEPT1], stores: [DEPT1], users: [ADMIN, NV_EMPTY, NV_CONFLICT_YES, NV_CONFLICT_NO],
    employeeProfiles: [
      { employeeCode: 'NV100', fullName: 'Nguyễn Văn Trống', username: 'nv.empty', dept: DEPT1, jobTitle: 'Nhân viên', status: 'ACTIVE', workEmail: 'nv.empty@hcrc.vn', contactPhone: '0909111222', joinDateAtHcrc: '2024-03-15' },
      { employeeCode: 'NV200', fullName: 'Trần Thị Lệch Một', username: 'nv.conflict.yes', dept: DEPT1, jobTitle: 'Nhân viên', status: 'ACTIVE', workEmail: 'lech.moi@hcrc.vn', contactPhone: '0911222333', joinDateAtHcrc: '2025-06-01' },
      { employeeCode: 'NV201', fullName: 'Trần Thị Lệch Hai', username: 'nv.conflict.no', dept: DEPT1, jobTitle: 'Nhân viên', status: 'ACTIVE', workEmail: 'lech.moi2@hcrc.vn', contactPhone: '0911222444', joinDateAtHcrc: '2025-07-01' }
    ]
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1000, height: 820 });
  const jsErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().includes('Mock chỉ hỗ trợ patch-mode')) jsErrors.push(msg.text()); });
  page.on('pageerror', (err) => jsErrors.push(String(err)));
  const snapEl = async (name, selector) => {
    const el = await page.$(selector);
    if (el) {
      // Cuộn phần tử lên ĐẦU viewport trước khi chụp (tránh thanh điều hướng sticky ở trên đè lên phần
      // đầu khối đang chụp — el.screenshot() tự cuộn tới nhưng không trừ hao chiều cao thanh sticky).
      await el.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -120));
      await page.waitForTimeout(80);
      await el.screenshot({ path: path.join(OUT_DIR, name) });
    }
    console.log('📸 ' + name);
  };

  async function openEditFor(username) {
    await page.evaluate((u) => {
      renderUsers();
      const row = [...document.querySelectorAll('#userTableBody tr')].find(tr => tr.textContent.includes(u));
      const btn = row && row.querySelector('[data-op="editUser"]');
      if (btn) btn.click();
    }, username);
  }

  try {
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('system'); setSystemSubTab('ADMIN'); });
    await page.waitForTimeout(150);

    // ===== 1) Trước khi bấm Sửa: thông tin Email/SĐT/Ngày Vào Làm Việc của nv.empty TRỐNG =====
    console.log('--- nv.empty (3 trường TRỐNG trên tài khoản, Hồ Sơ NS có đủ) ---');

    // ===== 2) Bấm "Sửa" nv.empty -> tự điền NGAY, KHÔNG cần bấm nút "Tìm Trong..." nào =====
    await openEditFor('nv.empty');
    await page.waitForTimeout(400);
    const afterEmpty = await page.evaluate(() => ({
      email: document.getElementById('uEmail').value,
      phone: document.getElementById('uPhone').value,
      startDate: document.getElementById('uStartDate').value
    }));
    console.log('Sau khi bấm Sửa (tự động, không bấm nút nào):', JSON.stringify(afterEmpty));
    await snapEl('1-nv-empty-auto-filled.png', '#userIdentityFields');
    await page.evaluate(() => cancelPermFormEdit());
    await page.waitForTimeout(150);

    // ===== 3) nv.conflict.yes: 3 trường ĐÃ CÓ SẴN giá trị KHÁC Hồ Sơ Nhân Sự -> hỏi trước khi ghi đè,
    //     demo chọn "Đồng ý" (window.confirm mặc định trả true trong harness test) =====
    console.log('--- nv.conflict.yes (3 trường ĐÃ CÓ, lệch Hồ Sơ NS, demo bấm "Đồng Ý" ghi đè) ---');
    await page.evaluate(() => { window.__confirms = []; window.__confirmAnswers = []; }); // mặc định true
    const beforeYes = { email: NV_CONFLICT_YES.email, phone: NV_CONFLICT_YES.phone, startDate: NV_CONFLICT_YES.startDate };
    console.log('Trước khi bấm Sửa (giá trị cũ đang có):', JSON.stringify(beforeYes));
    await openEditFor('nv.conflict.yes');
    await page.waitForTimeout(400);
    const confirmMsgYes = await page.evaluate(() => (window.__confirms || [])[0] || '(không có hộp thoại nào — có thể không lệch)');
    console.log('Nội dung hộp thoại xác nhận:\n' + confirmMsgYes);
    const afterYes = await page.evaluate(() => ({
      email: document.getElementById('uEmail').value,
      phone: document.getElementById('uPhone').value,
      startDate: document.getElementById('uStartDate').value
    }));
    console.log('Sau khi "Đồng Ý" ghi đè:', JSON.stringify(afterYes));
    await snapEl('2-nv-conflict-yes-overwritten.png', '#userIdentityFields');
    await page.evaluate(() => cancelPermFormEdit());
    await page.waitForTimeout(150);

    // ===== 4) nv.conflict.no: CÙNG tình huống nhưng demo bấm "Huỷ" (từ chối ghi đè) =====
    console.log('--- nv.conflict.no (3 trường ĐÃ CÓ, lệch Hồ Sơ NS, demo bấm "Huỷ" KHÔNG ghi đè) ---');
    await page.evaluate(() => { window.__confirms = []; window.__confirmAnswers = [false]; }); // lượt confirm() KẾ TIẾP trả false
    const beforeNo = { email: NV_CONFLICT_NO.email, phone: NV_CONFLICT_NO.phone, startDate: NV_CONFLICT_NO.startDate };
    console.log('Trước khi bấm Sửa (giá trị cũ đang có):', JSON.stringify(beforeNo));
    await openEditFor('nv.conflict.no');
    await page.waitForTimeout(400);
    const confirmMsgNo = await page.evaluate(() => (window.__confirms || [])[0] || '(không có hộp thoại nào — có thể không lệch)');
    console.log('Nội dung hộp thoại xác nhận:\n' + confirmMsgNo);
    const afterNo = await page.evaluate(() => ({
      email: document.getElementById('uEmail').value,
      phone: document.getElementById('uPhone').value,
      startDate: document.getElementById('uStartDate').value
    }));
    console.log('Sau khi "Huỷ" (giữ nguyên, KHÔNG ghi đè):', JSON.stringify(afterNo));
    await snapEl('3-nv-conflict-no-kept.png', '#userIdentityFields');

    console.log('\nLỗi JS phát sinh:', jsErrors.length ? jsErrors.join(' | ') : '(không có)');
    console.log('\n✅ Demo xong — ảnh lưu tại:', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})();
