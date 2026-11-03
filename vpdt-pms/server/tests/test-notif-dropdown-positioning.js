// server/tests/test-notif-dropdown-positioning.js
//
// Regression test cho lỗi người dùng báo (11/2026, kèm 2 ảnh chụp màn hình — desktop lẫn mobile): khung
// "🔔 Thông báo" hiện ra nhưng bị "đè"/lẫn với nhãn sidebar (nav phía trên + khối liên hệ "Đào Phan Anh"
// phía dưới), đọc không rõ. Gốc lỗi THẬT xác nhận được qua đo đạc (Playwright getBoundingClientRect()):
// #notifDropdownPanel trước đây "position:absolute" (lồng trong #userHeader — sidebar 16rem=256px,
// overflow-y:auto) với bề rộng cố định "w-72" (288px) + lề trái 12px (p-3 của khối cha) -> mép PHẢI của
// khung = 12+288 = 300px, VƯỢT QUÁ bề ngang 256px của sidebar tới 44px — khung "thông báo" tràn hẳn ra
// ngoài sidebar. Thêm nữa, #userHeader ở mobile (<768px, app.css) có "transform: translateX()" khi
// trượt vào/ra — transform đó tự tạo 1 stacking-context MỚI cho toàn bộ sidebar, khiến z-index bên trong
// (dù đã z-50) không còn đáng tin cậy ở ranh giới ngoài sidebar, đặc biệt lúc đang chạy transition trượt.
//
// Bản vá: #notifDropdownPanel đổi hẳn sang "position:fixed" + toạ độ do positionNotifDropdown() (core.js)
// tự tính theo getBoundingClientRect() của #btnNotifBell/#userHeader mỗi lần mở — CÙNG kỹ thuật widget
// "sdd*" (xem sddPositionAndShow()) đã dùng để tránh đúng lớp lỗi "khung nổi tự dựng bị kẹt/lệch bởi
// overflow/transform của khối cha".
//
// Chạy: node server/tests/test-notif-dropdown-positioning.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8998;
const ADMIN = {
  username: 'admin1', name: 'Đào Phan Anh', dept: 'Ban Giám Đốc', role: 'STAFF',
  phone: '0772231981', email: 'anh.do@brgroup.vn', jobTitle: 'Quản trị', perms: { admin: true }, active: true,
  totpEnabled: true
};

async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

async function stubNotifFetch(page) {
  await page.evaluate(() => {
    const origFetch = window.fetch;
    window.fetch = async (url, opts) => {
      if (String(url).startsWith('/api/notifications')) {
        const notifs = [{ id: 'n1', title: 'Thiếu người duyệt: Đăng ký xe', message: 'Vui lòng cấu hình lại người duyệt.', isRead: false, createdAt: '13:25:10 03/11/2026', linkTo: null }];
        return { ok: true, status: 200, json: async () => ({ unreadCount: notifs.length, notifications: notifs }) };
      }
      return origFetch(url, opts);
    };
  });
}

async function main() {
  const state = createMockState({ depts: ['Ban Giám Đốc'], users: [ADMIN] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const run = createRunner();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String((err && err.message) || err)));

  try {
    await page.evaluate(() => Promise.all(Object.keys(typeof MODULE_LOAD_GROUPS !== 'undefined' ? MODULE_LOAD_GROUPS : {}).map(k => loadModuleGroup(k))));
    await page.evaluate(() => Promise.all(Object.keys(typeof TAB_SECTION_FRAGMENT !== 'undefined' ? TAB_SECTION_FRAGMENT : {}).map(k => loadTabSectionHtml(k))));
    await page.waitForTimeout(150);
    await loginAs(page, ADMIN);
    await stubNotifFetch(page);

    // ===================== DESKTOP (>=768px) =====================
    await page.setViewportSize({ width: 1280, height: 620 });

    await run.run('#notifDropdownPanel là position:fixed (không còn absolute lồng trong #userHeader)', async () => {
      const pos = await page.evaluate(() => getComputedStyle(document.getElementById('notifDropdownPanel')).position);
      assertEqual(pos, 'fixed', '#notifDropdownPanel phải dùng position:fixed (toạ độ JS tự tính, xem positionNotifDropdown())');
    });

    await run.run('Sidebar cuộn xuống đáy + bấm chuông -> khung Thông báo nằm GỌN trong bề ngang sidebar (không tràn phải như bản lỗi cũ)', async () => {
      await page.evaluate(() => { document.getElementById('userHeader').scrollTop = document.getElementById('userHeader').scrollHeight; });
      await page.click('#btnNotifBell');
      await page.waitForTimeout(150);
      const info = await page.evaluate(() => {
        const panel = document.getElementById('notifDropdownPanel');
        const aside = document.getElementById('userHeader');
        return { panelRect: panel.getBoundingClientRect(), asideRect: aside.getBoundingClientRect(), hidden: panel.classList.contains('hidden') };
      });
      assert(!info.hidden, 'Khung thông báo phải đang mở sau khi bấm chuông');
      assert(info.panelRect.right <= info.asideRect.right + 1,
        `LỖI ĐÃ VÁ: mép phải khung (${info.panelRect.right}) KHÔNG được vượt quá mép phải sidebar (${info.asideRect.right}) — bản lỗi cũ tràn tới 44px`);
      assert(info.panelRect.left >= info.asideRect.left - 1, 'Mép trái khung phải nằm trong sidebar');
    });

    await run.run('Khung Thông báo nằm NGAY TRÊN nút chuông (bottom của khung ~ top của nút, không đè lên nút)', async () => {
      const info = await page.evaluate(() => {
        const panel = document.getElementById('notifDropdownPanel');
        const btn = document.getElementById('btnNotifBell');
        return { panelBottom: panel.getBoundingClientRect().bottom, btnTop: btn.getBoundingClientRect().top };
      });
      assert(info.panelBottom <= info.btnTop + 2, `Khung phải kết thúc NGAY TRÊN nút chuông (panelBottom=${info.panelBottom}, btnTop=${info.btnTop})`);
    });

    await run.run('Cuộn trang (scroll aside) khi khung đang mở -> tự định vị lại theo vị trí MỚI của nút chuông (không kẹt ở toạ độ cũ)', async () => {
      const before = await page.evaluate(() => document.getElementById('notifDropdownPanel').getBoundingClientRect().bottom);
      await page.evaluate(() => { document.getElementById('userHeader').scrollTop = 0; document.getElementById('userHeader').dispatchEvent(new Event('scroll', { bubbles: true })); });
      await page.waitForTimeout(100);
      const after = await page.evaluate(() => document.getElementById('notifDropdownPanel').getBoundingClientRect().bottom);
      assert(before !== after, `Vị trí khung phải đổi theo vị trí mới của nút chuông sau khi cuộn (trước=${before}, sau=${after})`);
    });

    // ===================== MOBILE (<768px, sidebar off-canvas trượt vào/ra bằng transform) =====================
    await run.run('Mobile: bấm chuông NGAY LÚC sidebar đang trong 0.2s transition trượt vào -> khung vẫn hiện gọn trong sidebar, không tràn/lệch', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { document.getElementById('notifDropdownPanel').classList.add('hidden'); });
      await page.evaluate(() => toggleMobileSidebar());
      await page.waitForTimeout(60); // giữa chừng transition 0.2s — kịch bản xấu nhất
      await page.click('#btnNotifBell');
      await page.waitForTimeout(300); // hết transition + fetch xong
      const info = await page.evaluate(() => {
        const panel = document.getElementById('notifDropdownPanel');
        const aside = document.getElementById('userHeader');
        return { panelRect: panel.getBoundingClientRect(), asideRect: aside.getBoundingClientRect(), hidden: panel.classList.contains('hidden') };
      });
      assert(!info.hidden, 'Khung thông báo phải mở được trên mobile dù bấm giữa lúc sidebar đang trượt');
      assert(info.panelRect.right <= info.asideRect.right + 1, `Mobile: mép phải khung (${info.panelRect.right}) không được vượt sidebar (${info.asideRect.right})`);
      assert(info.panelRect.width > 0 && info.panelRect.height > 0, 'Khung phải có kích thước thật (không bị co về 0 do lỗi định vị)');
    });

    await run.run('KHÔNG có lỗi JS (pageerror) nào phát sinh suốt bài test', async () => {
      assertEqual(pageErrors.length, 0, `Có lỗi JS: ${JSON.stringify(pageErrors)}`);
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
