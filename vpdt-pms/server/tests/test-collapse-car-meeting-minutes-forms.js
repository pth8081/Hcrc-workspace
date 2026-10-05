// server/tests/test-collapse-car-meeting-minutes-forms.js
//
// Regression test cho đợt "thu gọn form nhập" (10/2026) áp dụng pattern có sẵn ở Mua Hàng
// (#mhVendorFormWrap/openMhVendorForm()/closeMhVendorForm(), xem public/fragments/muaHangSection.html +
// public/js/module-muahang.js) cho 4 form còn lại: #officeForm/#carForm/#meetingForm/#minutesForm. File
// này chỉ kiểm 2 form LOẠI khác nhau nhất trong nhóm (xem PLAN đợt này):
//   - #carForm: LOẠI A thường (ẩn mặc định/nút mở riêng độc lập quyền), kèm lộ trình nhiều điểm động
//     (carRoutePoints) phải được reset đúng mỗi lần mở lại (xem openCarForm(), module-dangkyxe.js).
//   - #minutesForm: LOẠI B (ẩn/hiện CHỈ theo quyền canCreateMeetingMinutes(), core.js — nút "+ Lập Biên
//     Bản Mới" CHỈ hiện cho người có quyền, form vẫn ẩn mặc định dù có quyền).
// #officeForm/#meetingForm đã có test hồi quy riêng (test-office-budget.js/test-meeting-edit-ui.js) +
// đã tự chạy qua test-form-reset-file-remove.js (cả 4 form) trong cùng đợt sửa này.
//
// Chạy: node server/tests/test-collapse-car-meeting-minutes-forms.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8993;

// ===== Users =====
const CAR_USER = {
  username: 'nv_xe', name: 'Nhân Viên Đăng Ký Xe', dept: 'Phòng Kinh Doanh', role: 'STAFF',
  phone: '0900000011', email: 'nv_xe@company.com', jobTitle: 'Nhân viên', perms: {}, active: true
};
// Không có quyền lập biên bản (không admin, không minutesCreate) — chỉ xem danh sách.
const MINUTES_NO_PERM_USER = {
  username: 'nv_thuong', name: 'Nhân Viên Thường', dept: 'Phòng Kinh Doanh', role: 'STAFF',
  phone: '0900000012', email: 'nv_thuong@company.com', jobTitle: 'Nhân viên', perms: {}, active: true
};
// Có quyền minutesCreate — thấy nút "+ Lập Biên Bản Mới", đồng thời là creator của biên bản seed sẵn bên
// dưới (canEditMeetingMinutesRecord() cho phép creator sửa chính biên bản mình tạo).
const MINUTES_CREATOR_USER = {
  username: 'thu_ky', name: 'Thư Ký Cuộc Họp', dept: 'Phòng Hành Chính', role: 'STAFF',
  phone: '0900000013', email: 'thu_ky@company.com', jobTitle: 'Thư ký', perms: { minutesCreate: true }, active: true
};

const EXISTING_MINUTES = {
  id: 5001, code: 'HCRC-HC-BBH-5001', title: 'Họp giao ban tuần (seed sẵn)', time: '2026-10-01T09:00',
  location: 'Phòng họp A', chair: 'Giám Đốc', secretary: 'Thư Ký Cuộc Họp', content: 'Nội dung đã lưu.',
  attendees: [], directives: [], customData: {}, tasksAssigned: false, creator: 'thu_ky', creatorName: 'Thư Ký Cuộc Họp',
  createdAt: '01/10/2026 09:00:00'
};

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function main() {
  const state = createMockState({
    depts: ['Phòng Kinh Doanh', 'Phòng Hành Chính'],
    users: [CAR_USER, MINUTES_NO_PERM_USER, MINUTES_CREATOR_USER],
    meetingMinutes: [EXISTING_MINUTES]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();

  try {
    // ===================== #carForm (LOẠI A) =====================
    await loginAs(page, CAR_USER);

    await run.run('#carForm ẩn mặc định khi vừa vào tab "Đăng Ký Xe"', async () => {
      await page.evaluate(() => switchTab('car'));
      const hidden = await page.evaluate(() => document.getElementById('carForm').classList.contains('hidden'));
      assertEqual(hidden, true, '#carForm phải có class "hidden" ngay khi vừa mở tab, trước khi bấm nút mở');
    });

    await run.run('Bấm nút thật "+ Đăng Ký Mới" (data-op="openCarForm") -> #carForm hiện ra', async () => {
      const btn = page.locator('#btnCarFormNew');
      assertEqual(await btn.count(), 1, 'Phải có đúng 1 nút #btnCarFormNew trong DOM');
      await btn.click();
      const hidden = await page.evaluate(() => document.getElementById('carForm').classList.contains('hidden'));
      assertEqual(hidden, false, 'Bấm nút mở xong #carForm phải hiện (không còn class "hidden")');
    });

    await run.run('Lộ Trình Di Chuyển: mặc định đúng 2 ô trống (Điểm xuất phát + 1 điểm đến) ngay khi vừa mở form', async () => {
      const state2 = await page.evaluate(() => ({
        count: document.querySelectorAll('#carRoutePointsWrap input').length,
        values: Array.from(document.querySelectorAll('#carRoutePointsWrap input')).map((el) => el.value)
      }));
      assertEqual(state2.count, 2, 'Phải có đúng 2 ô Lộ Trình khi form vừa mở lần đầu');
      assert(state2.values.every((v) => v === ''), 'Cả 2 ô Lộ Trình phải trống khi form vừa mở');
    });

    await run.run('Thêm 1 điểm + điền cả 3 ô, rồi bấm nút thật "✕ Thu Gọn" (data-op="closeCarForm") -> #carForm ẩn lại', async () => {
      await page.click('button[data-op="addCarRoutePoint"]');
      const count3 = await page.locator('#carRoutePointsWrap input').count();
      assertEqual(count3, 3, 'Phải có 3 ô Lộ Trình sau khi bấm "+ Thêm Điểm"');
      await page.locator('#carRoutePointsWrap input').nth(0).fill('Hội An');
      await page.locator('#carRoutePointsWrap input').nth(1).fill('Đà Nẵng');
      await page.locator('#carRoutePointsWrap input').nth(2).fill('Huế');

      const closeBtn = page.locator('#carForm button[data-op="closeCarForm"]');
      assertEqual(await closeBtn.count(), 1, 'Phải có đúng 1 nút "✕ Thu Gọn" (data-op="closeCarForm") trong #carForm');
      await closeBtn.click();
      const hidden = await page.evaluate(() => document.getElementById('carForm').classList.contains('hidden'));
      assertEqual(hidden, true, 'Bấm "✕ Thu Gọn" xong #carForm phải ẩn lại');
    });

    await run.run('Mở lại form (bấm "+ Đăng Ký Mới" lần 2) -> Lộ Trình phải RESET về lại ĐÚNG 2 ô trống (không giữ 3 ô đã điền ở lần trước)', async () => {
      await page.locator('#btnCarFormNew').click();
      const hidden = await page.evaluate(() => document.getElementById('carForm').classList.contains('hidden'));
      assertEqual(hidden, false, '#carForm phải hiện lại sau khi bấm "+ Đăng Ký Mới" lần 2');
      const state3 = await page.evaluate(() => ({
        count: document.querySelectorAll('#carRoutePointsWrap input').length,
        values: Array.from(document.querySelectorAll('#carRoutePointsWrap input')).map((el) => el.value)
      }));
      assertEqual(state3.count, 2, 'Mở lại (đăng ký mới) phải về ĐÚNG 2 ô Lộ Trình, không phải 3 ô đã điền trước lúc đóng');
      assert(state3.values.every((v) => v === ''), 'Cả 2 ô Lộ Trình phải trống lại sau khi mở form mới (không giữ "Hội An"/"Đà Nẵng"/"Huế" cũ)');
    });

    // ===================== #minutesForm (LOẠI B — gác theo canCreateMeetingMinutes()) =====================
    await run.run('Người KHÔNG có quyền lập biên bản: #minutesForm ẩn + KHÔNG thấy nút "+ Lập Biên Bản Mới" + hiện ghi chú "không có quyền"', async () => {
      await loginAs(page, MINUTES_NO_PERM_USER);
      await page.evaluate(() => switchTab('minutes'));
      const s = await page.evaluate(() => ({
        formHidden: document.getElementById('minutesForm').classList.contains('hidden'),
        btnHidden: document.getElementById('btnMinutesFormNew').classList.contains('hidden'),
        noteHidden: document.getElementById('minutesNoPermNote').classList.contains('hidden')
      }));
      assertEqual(s.formHidden, true, '#minutesForm phải ẩn (người không có quyền trước đây cũng không thấy form)');
      assertEqual(s.btnHidden, true, 'Nút "+ Lập Biên Bản Mới" KHÔNG được hiện cho người không có quyền canCreateMeetingMinutes()');
      assertEqual(s.noteHidden, false, 'Ghi chú "⛔ Bạn không có quyền lập biên bản họp" phải hiện');
    });

    await run.run('Người CÓ quyền lập biên bản (minutesCreate): #minutesForm VẪN ẩn mặc định, nhưng nút "+ Lập Biên Bản Mới" hiện + ghi chú "không có quyền" ẩn', async () => {
      await loginAs(page, MINUTES_CREATOR_USER);
      await page.evaluate(() => switchTab('minutes'));
      const s = await page.evaluate(() => ({
        formHidden: document.getElementById('minutesForm').classList.contains('hidden'),
        btnHidden: document.getElementById('btnMinutesFormNew').classList.contains('hidden'),
        noteHidden: document.getElementById('minutesNoPermNote').classList.contains('hidden')
      }));
      assertEqual(s.formHidden, true, '#minutesForm phải ẩn mặc định dù người này CÓ quyền tạo (đúng pattern "thu gọn form nhập" — phải bấm nút mới mở)');
      assertEqual(s.btnHidden, false, 'Nút "+ Lập Biên Bản Mới" phải hiện cho người có quyền canCreateMeetingMinutes()');
      assertEqual(s.noteHidden, true, 'Ghi chú "không có quyền" phải ẩn vì người này CÓ quyền');
    });

    await run.run('Bấm nút thật "+ Lập Biên Bản Mới" (data-op="openMinutesForm") -> #minutesForm hiện ra', async () => {
      const btn = page.locator('#btnMinutesFormNew');
      assertEqual(await btn.count(), 1, 'Phải có đúng 1 nút #btnMinutesFormNew trong DOM');
      await btn.click();
      const hidden = await page.evaluate(() => document.getElementById('minutesForm').classList.contains('hidden'));
      assertEqual(hidden, false, 'Bấm nút mở xong #minutesForm phải hiện');
    });

    await run.run('Bấm nút thật "✕ Thu Gọn" (data-op="closeMinutesForm") trong #minutesForm -> ẩn lại', async () => {
      const closeBtn = page.locator('#minutesForm button[data-op="closeMinutesForm"]');
      assertEqual(await closeBtn.count(), 1, 'Phải có đúng 1 nút "✕ Thu Gọn" (data-op="closeMinutesForm") trong #minutesForm');
      await closeBtn.click();
      const hidden = await page.evaluate(() => document.getElementById('minutesForm').classList.contains('hidden'));
      assertEqual(hidden, true, 'Bấm "✕ Thu Gọn" xong #minutesForm phải ẩn lại');
    });

    await run.run('openEditMeetingMinutes(): mở lại #minutesForm (đang ẩn) để Sửa 1 biên bản đã có, kể cả khi KHÔNG đi qua nút "+ Lập Biên Bản Mới"', async () => {
      // #minutesForm đang ẩn (vừa "✕ Thu Gọn" ở bước trước) — openEditMeetingMinutes() (nút "✏️ Sửa" của
      // dòng biên bản trong danh sách) phải tự mở lại form này, không để người dùng bấm "Sửa" mà form vẫn ẩn.
      const s = await page.evaluate((id) => {
        openEditMeetingMinutes(id);
        return {
          formHidden: document.getElementById('minutesForm').classList.contains('hidden'),
          editingId: editingMinutesId,
          titleValue: document.getElementById('minutesTitle').value
        };
      }, EXISTING_MINUTES.id);
      assertEqual(s.formHidden, false, 'openEditMeetingMinutes() phải tự mở lại #minutesForm (gọi openMinutesForm())');
      assertEqual(s.editingId, EXISTING_MINUTES.id, 'editingMinutesId phải đúng id biên bản đang sửa');
      assertEqual(s.titleValue, EXISTING_MINUTES.title, 'Form phải đổ sẵn đúng dữ liệu cũ của biên bản đang sửa');
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
