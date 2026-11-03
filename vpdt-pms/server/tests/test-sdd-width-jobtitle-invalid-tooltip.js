// server/tests/test-sdd-width-jobtitle-invalid-tooltip.js
//
// Regression test cho 2 yêu cầu người dùng (11/2026, kèm 2 ảnh chụp màn hình):
//
// (1) "chỗ phân quyền siêu thị, chức danh, phòng ban bạn cho theo kiểu dropdown tìm kiếm giúp mình nhé,
//     độ rộng mở theo độ dài của ký tự" — ảnh chụp #uStoreFieldWrap cho thấy khung gợi ý bị cắt cụt tên
//     siêu thị dài ("Cửa hàng 5 Hàm Tử ...", "Siêu thị số 275 Ngu..."). #uDept/#uStore đã là widget
//     "sdd*" từ trước, nhưng khung gợi ý LUÔN rộng đúng bằng ô input (sddPositionAndShow() cũ) — cắt cụt
//     chữ dài trong lưới form hẹp. #uJobTitle (Chức Danh) VẪN còn là <select> gốc, chưa nâng cấp.
//     Bản vá: (a) sddPositionAndShow() giờ tự đo bề rộng chữ dài nhất đang hiển thị, nới khung gợi ý
//     theo đó (có trần 480px/viewport, không đổi độ rộng CHÍNH ô input); (b) #uJobTitle nâng cấp sang
//     cùng widget sdd* như #uDept/#uStore (xem populateUserJobTitleOptions(), core.js).
//
// (2) "ảnh 2 thông báo này cần hiển thị lên trên để đọc rõ hơn nhé" — ảnh chụp bong bóng validation mặc
//     định của trình duyệt ("Please enter a valid value...") hiện NGAY DƯỚI ô Thời Gian Bắt Đầu Đi (Đăng
//     Ký Xe), đè lên nhãn/ô bên dưới trong lưới 3 cột. Bản vá: chặn hẳn bong bóng mặc định (ev.
//     preventDefault() trên 'invalid', áp dụng CHUNG document-level — core.js) + tự vẽ tooltip đỏ NGAY
//     TRÊN ô invalid (position:fixed, đo offsetHeight thật để đặt top chính xác).
//
// Chạy: node server/tests/test-sdd-width-jobtitle-invalid-tooltip.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8997;

// totpEnabled:true BẮT BUỘC cho user có perms.admin — thiếu field này, proceedAfterAuth() (core.js) sẽ tự
// mở openTotpSetupWall() chặn HẲN toàn bộ UI (initDatabase() không chạy, mọi DB.* rỗng, mọi click bị
// chặn bởi #totpSetupWallModal che phủ) — lỗi gài bẫy ĐÃ gặp ở các bộ test admin khác, xem CLAUDE.md.
const ADMIN = {
  username: 'admin1', name: 'Quản Trị Viên', dept: 'Ban Giám Đốc', role: 'STAFF',
  phone: '0900000001', email: 'admin1@company.com', jobTitle: 'Người điều hành', perms: { admin: true }, active: true,
  totpEnabled: true
};

const LONG_STORE_NAME = 'Siêu thị số 275 Nguyễn Văn Linh, Phường Tân Phong, Quận 7, Thành Phố Hồ Chí Minh';

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function main() {
  const state = createMockState({
    depts: ['Ban Giám Đốc', 'Phòng Kinh Doanh'],
    users: [ADMIN],
    stores: ['Cửa hàng A', LONG_STORE_NAME],
    jobTitles: ['Nhân viên', 'Trưởng phòng', 'Người điều hành']
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    // Nạp TOÀN BỘ cụm module + khung HTML lazy-load theo tab (cùng khuôn test-admin-users-permgroups.js)
    // — #uJobTitle/#uStore nằm trong systemSection.html, nạp lười theo tab.
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
    await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));
    await page.waitForTimeout(150);

    await loginAs(page, ADMIN);
    await page.evaluate(() => { window.__alerts = []; window.alert = (m) => window.__alerts.push(String(m)); window.confirm = () => true; });
    // #userPermFormWrap (bọc toàn bộ form #uUsername/#uJobTitle/#uStore) ẩn mặc định — chỉ mở khi bấm
    // "+ Thêm Người Dùng Mới" thật (openCreateUserForm(), module-admin-userstaging.js), KHÔNG phải tự
    // mở khi gọi resetUserForm() suông (hàm đó chỉ xoá trắng form, không đụng tới class "hidden").
    await page.evaluate(() => { switchTab('system'); openCreateUserForm(); });

    // ===================== (1a) #uJobTitle nâng cấp sang widget sdd* =====================
    await run.run('#uJobTitle giờ là <input data-sdd-list> (không còn <select> gốc), có khung gợi ý #uJobTitleDatalist', async () => {
      const info = await page.evaluate(() => {
        const el = document.getElementById('uJobTitle');
        return { tag: el && el.tagName, hasSddList: !!(el && el.getAttribute('data-sdd-list')), ddExists: !!document.getElementById('uJobTitleDatalist') };
      });
      assertEqual(info.tag, 'INPUT', '#uJobTitle phải đổi từ <select> sang <input> (widget sdd*)');
      assert(info.hasSddList, '#uJobTitle phải có data-sdd-list trỏ tới khung gợi ý');
      assert(info.ddExists, 'Phải có #uJobTitleDatalist trong DOM');
    });

    await run.run('resetUserForm() + đổi uPosType -> populateUserJobTitleOptions() nạp đúng danh mục chức danh vào sddItems', async () => {
      const r = await page.evaluate(() => {
        resetUserForm(); // form đã mở (openCreateUserForm() ở trên) — chỉ xoá trắng, không đụng hidden
        return {
          items: (document.getElementById('uJobTitleDatalist')._sddItems || []).map(it => it.label)
        };
      });
      assert(r.items.length > 0, 'Phải nạp được ít nhất 1 chức danh vào gợi ý Chức Danh');
    });

    await run.run('Bấm vào #uJobTitle (focusin thật) -> hiện gợi ý; gõ tìm lọc đúng; bấm chọn 1 dòng -> ô nhận đúng giá trị', async () => {
      await page.click('#uJobTitle');
      const rowsBefore = await page.evaluate(() => Array.from(document.querySelectorAll('#uJobTitleDatalist [data-sdd-idx]')).map(e => e.textContent));
      assert(rowsBefore.length > 0, 'Bấm vào ô phải hiện toàn bộ danh sách gợi ý (focusin)');
      const picked = rowsBefore[0];
      await page.evaluate((label) => {
        const row = Array.from(document.querySelectorAll('#uJobTitleDatalist [data-sdd-idx]')).find(e => e.textContent === label);
        row.click();
      }, picked);
      const val = await page.evaluate(() => document.getElementById('uJobTitle').value);
      assertEqual(val, picked, 'Bấm chọn 1 gợi ý phải gán đúng giá trị vào #uJobTitle (đọc qua .value y hệt <select> cũ, các nơi khác saveUser()/editUser() không cần sửa gì thêm)');
    });

    // ===================== (1b) Khung gợi ý TỰ CO GIÃN theo chữ dài nhất =====================
    await run.run('Khung gợi ý #uStoreDatalist rộng HƠN ô input khi có tên siêu thị dài — không còn bị cắt cụt theo đúng độ rộng ô input hẹp', async () => {
      // #uStoreFieldWrap chỉ hiện khi Vị Trí Làm Việc = STORE (xem onUserPosTypeChange(), core.js).
      await page.evaluate(() => { document.getElementById('uPosType').value = 'STORE'; onUserPosTypeChange(); sddSetOptions('uStoreDatalist', DB.stores); });
      await page.click('#uStore');
      await page.waitForTimeout(30);
      const r = await page.evaluate(() => {
        const input = document.getElementById('uStore');
        const dd = document.getElementById('uStoreDatalist');
        return { inputWidth: input.getBoundingClientRect().width, ddWidth: dd.getBoundingClientRect().width, ddHidden: dd.classList.contains('hidden') };
      });
      assert(!r.ddHidden, 'Khung gợi ý phải đang hiện');
      assert(r.ddWidth > r.inputWidth + 20, `Khung gợi ý (${r.ddWidth}px) phải RỘNG HƠN rõ rệt so với ô input (${r.inputWidth}px) để chứa được tên siêu thị dài, không bị cắt cụt`);
    });

    await run.run('Khung gợi ý không tràn khỏi mép phải màn hình (tự lùi left vào trong viewport)', async () => {
      const r = await page.evaluate(() => {
        const dd = document.getElementById('uStoreDatalist');
        const rect = dd.getBoundingClientRect();
        return { right: rect.right, viewportWidth: window.innerWidth };
      });
      assert(r.right <= r.viewportWidth + 1, `Khung gợi ý phải nằm trong viewport (right=${r.right}, viewport=${r.viewportWidth})`);
    });

    // ===================== (2) Tooltip "invalid" hiện TRÊN ô thay vì bong bóng mặc định =====================
    await run.run('Ô required rỗng + bấm submit -> KHÔNG dùng bong bóng mặc định, tự hiện tooltip đỏ NGAY TRÊN ô (top < rect.top)', async () => {
      const r = await page.evaluate(() => {
        const form = document.createElement('form');
        form.id = '__testInvalidForm';
        const input = document.createElement('input');
        input.id = '__testInvalidInput';
        input.required = true;
        input.style.position = 'relative';
        input.style.marginTop = '300px'; // chừa chỗ PHÍA TRÊN để tooltip có thể đặt nằm trên
        const btn = document.createElement('button');
        btn.type = 'submit';
        btn.id = '__testInvalidSubmitBtn';
        btn.textContent = 'Gửi';
        form.appendChild(input);
        form.appendChild(btn);
        document.body.appendChild(form);
        window.__testSubmitFired = false;
        form.addEventListener('submit', (e) => { e.preventDefault(); window.__testSubmitFired = true; });
        return true;
      });
      assert(r, 'Phải tạo được form test');

      await page.click('#__testInvalidSubmitBtn');
      await page.waitForTimeout(30);

      const after = await page.evaluate(() => {
        const input = document.getElementById('__testInvalidInput');
        const rect = input.getBoundingClientRect();
        const tip = document.querySelector('.bg-red-600.z-\\[9999\\]');
        return {
          submitFired: window.__testSubmitFired,
          focusedInput: document.activeElement === input,
          tipExists: !!tip,
          tipText: tip ? tip.textContent : null,
          tipTop: tip ? tip.getBoundingClientRect().top : null,
          inputTop: rect.top,
          validationMessage: input.validationMessage
        };
      });
      assertEqual(after.submitFired, false, 'Form KHÔNG được submit khi còn ô required rỗng (hành vi chặn chuẩn của trình duyệt vẫn giữ nguyên)');
      assert(after.focusedInput, 'Trình duyệt/tooltip phải tự focus đúng ô invalid (giữ hành vi focus mặc định dù đã preventDefault "invalid")');
      assert(after.tipExists, 'Phải tự vẽ tooltip đỏ thay cho bong bóng mặc định của trình duyệt');
      assertEqual(after.tipText, after.validationMessage, 'Nội dung tooltip phải đúng validationMessage của ô');
      assert(after.tipTop < after.inputTop, `Tooltip phải nằm TRÊN ô (tipTop=${after.tipTop} phải < inputTop=${after.inputTop})`);
    });

    await run.run('Gõ vào ô vừa báo lỗi -> tooltip tự ẩn (không cần bấm gì thêm)', async () => {
      await page.fill('#__testInvalidInput', 'đã điền');
      await page.waitForTimeout(30);
      const tipExists = await page.evaluate(() => !!document.querySelector('.bg-red-600.z-\\[9999\\]'));
      assertEqual(tipExists, false, 'Tooltip phải tự biến mất ngay khi người dùng bắt đầu gõ để sửa');
    });

    await run.run('Bấm submit lần 2 (lúc này ô đã hợp lệ) -> form submit thật, KHÔNG còn chặn/hiện tooltip', async () => {
      await page.click('#__testInvalidSubmitBtn');
      await page.waitForTimeout(30);
      const after = await page.evaluate(() => ({ submitFired: window.__testSubmitFired, tipExists: !!document.querySelector('.bg-red-600.z-\\[9999\\]') }));
      assert(after.submitFired, 'Form phải submit được bình thường khi mọi ô đã hợp lệ (xác nhận bản vá KHÔNG chặn nhầm submit hợp lệ)');
      assertEqual(after.tipExists, false, 'Không có tooltip nào khi không có ô nào invalid');
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', (err && err.stack) || err);
  process.exitCode = 1;
});
