// tests/demo-kiemke-all-screens.js — demo Playwright THẬT chụp TOÀN BỘ màn hình liên quan "📋 Kiểm Kê"
// (Phase 1 MVP, 11/2026) để người dùng xác nhận trước khi merge: từ sidebar (menu bar) -> vị trí trong
// Vận Hành -> từng tab bên trong (Tab 1 "Kỳ Kiểm Kê" có dữ liệu thật + 7 tab còn lại "🚧 Đang phát triển").
// Chạy: node tests/demo-kiemke-all-screens.js — ảnh lưu ở demo-screenshots/kiemke-all-screens/.
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8994;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'kiemke-all-screens');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const MANAGER = {
    username: 'qlA', name: 'Nguyễn Văn Quản Lý', dept: 'Siêu thị Quận 1',
    // Có vài quyền Vận Hành KHÁC (để sidebar dropdown "⚙️ Vận Hành" hiện đủ các mục cũ, giống 1 Cửa hàng
    // trưởng thật) CỘNG kiemKePeriodManage — đúng vai "quản lý kỳ kiểm kê" thật.
    perms: { operationOrderCreate: true, shelfRecordCreate: true, kiemKePeriodManage: true },
    active: true, totpEnabled: true
  };
  const ADMIN = { username: 'admin', name: 'Admin Hệ Thống', dept: 'Siêu thị Quận 1', perms: { admin: true }, active: true, totpEnabled: true };
  const state = createMockState({ depts: ['Siêu thị Quận 1', 'Siêu thị Quận 2'], stores: ['Siêu thị Quận 1', 'Siêu thị Quận 2'], users: [MANAGER, ADMIN] });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1500, height: 1000 });
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push(String(err && err.stack || err)));

  let n = 0;
  const shot = async (label) => {
    n += 1;
    const file = `${String(n).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: false });
    console.log(`📸 ${file}`);
  };

  try {
    // ===== Đăng nhập Quản Lý (có kiemKePeriodManage) =====
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
    await page.waitForTimeout(150);

    // 1) Sidebar mặc định (chưa mở dropdown Vận Hành) — thấy icon "⚙️ Vận Hành ▾" trên menu bar.
    await shot('sidebar-mac-dinh');

    // 2) Mở dropdown "⚙️ Vận Hành ▾" trên sidebar — xem đủ shortcut, trong đó có "📋 Kiểm Kê" (MỚI thêm
    //    đợt này, mirror đúng các shortcut Đơn Hàng/QLDA/Checklist/Kiểm Soát Hàng Hóa đã có).
    await page.click('#btnVanHanhTab');
    await page.waitForTimeout(150);
    await shot('sidebar-mo-dropdown-van-hanh');

    // 3) Bấm vào Vận Hành (qua tab trong trang, không qua shortcut) — xem thanh sub-tab chính bên trong
    //    Vận Hành: Đơn Hàng / QLDA / Phê Duyệt Giá Bán Buôn / Kiểm Soát Hàng Hóa / Kiểm Kê.
    await page.evaluate(() => { closeVanHanhDropdown(); switchTab('vanHanh'); });
    await page.waitForTimeout(150);
    await shot('vanhanh-thanh-subtab-chinh');

    // 4) Bấm "📋 Kiểm Kê" — vào Tab 1 "📅 Kỳ Kiểm Kê", CHƯA có kỳ nào (trạng thái rỗng).
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(200);
    await shot('kiemke-tab1-rong');

    // 5) Tạo 1 kỳ Gom Mã (Nháp).
    await page.click('#btnKkPeriodOpenCreate');
    await page.selectOption('#kkNewLoaiKy', 'GOM_MA');
    await page.fill('#kkNewTenKy', 'Gom Mã Tuần 46/2026');
    await page.click('[data-op="submitCreateKkPeriod"]');
    await page.waitForTimeout(200);
    // 6) Tạo thêm 1 kỳ Thống Kê (Nháp) — minh hoạ 2 loại kỳ độc lập cùng lúc.
    await page.click('#btnKkPeriodOpenCreate');
    await page.selectOption('#kkNewLoaiKy', 'THONG_KE');
    await page.fill('#kkNewTenKy', 'Thống Kê Quý 4/2026');
    await page.click('[data-op="submitCreateKkPeriod"]');
    await page.waitForTimeout(200);
    await shot('kiemke-tab1-2-ky-nhap');

    // 7) Kích hoạt ĐÚNG kỳ Gom Mã (không phải nth=0 — danh sách sắp theo createdAt MỚI NHẤT lên đầu, kỳ
    //    Thống Kê tạo SAU nên đứng trước Gom Mã trong DOM) — chuyển "Đang hoạt động", hiện nút "Đóng Kỳ".
    const gomMaRow = page.locator('div.flex.items-center.justify-between', { has: page.getByText('Gom Mã Tuần 46/2026', { exact: true }) });
    await gomMaRow.locator('[data-op="activateKkPeriod"]').click();
    await page.waitForTimeout(200);
    await shot('kiemke-tab1-da-kich-hoat-gomma');

    // 8) Đóng kỳ Gom Mã vừa kích hoạt — chuyển "Đã chốt". Quản Lý (không phải Admin) KHÔNG thấy nút Mở Lại.
    await gomMaRow.locator('[data-op="closeKkPeriod"]').click();
    await page.waitForTimeout(200);
    await shot('kiemke-tab1-da-chot-khong-thay-mo-lai');

    // 9) Lọc "Thống Kê" — chỉ còn hiện kỳ Thống Kê (minh hoạ bộ lọc Loại Kỳ).
    await page.click('[data-op="setKkPeriodLoaiFilter"][data-arg0="THONG_KE"]');
    await page.waitForTimeout(150);
    await shot('kiemke-tab1-loc-thong-ke');
    await page.click('[data-op="setKkPeriodLoaiFilter"][data-arg0=""]');
    await page.waitForTimeout(150);

    // 10) 7 tab còn lại (Gom Mã/Kiểm Đếm/Kiểm Soát/Cấu Hình Quầy Kệ/Xác Nhận/Báo Cáo/Cấu Hình Người
    //     Dùng) — khung "🚧 Đang phát triển", KHÔNG phải nút chết. BẤM THẬT vào nút id #btnKkSub* (KHÔNG
    //     gọi setKiemKeSubTab() qua JS trực tiếp) — đúng cách người dùng thật bấm, và đây chính là đường
    //     đã lộ lỗi thật "8 nút sub-tab Kiểm Kê chết" (thiếu đăng ký OP_CLICK_ACTIONS, đã vá ngay trước
    //     khi chạy demo này) qua audit chéo trước merge.
    const remainingTabs = [
      ['btnKkSubGomMa', 'tab2-gom-ma'],
      ['btnKkSubKiemDem', 'tab3-kiem-dem'],
      ['btnKkSubKiemSoat', 'tab4-kiem-soat'],
      ['btnKkSubShelfConfig', 'tab5-cau-hinh-quay-ke'],
      ['btnKkSubConfirm', 'tab6-xac-nhan'],
      ['btnKkSubReport', 'tab7-bao-cao'],
      ['btnKkSubUserAccess', 'tab8-cau-hinh-nguoi-dung'],
    ];
    for (const [btnId, label] of remainingTabs) {
      await page.click(`#${btnId}`);
      await page.waitForTimeout(100);
      await shot(`kiemke-${label}-dang-phat-trien`);
    }
    // Quay lại Tab 1 BẰNG CÁCH BẤM THẬT (không gọi hàm trực tiếp) trước khi đổi người dùng.
    await page.click('#btnKkSubPeriod');
    await page.waitForTimeout(150);
    await shot('kiemke-tab1-bam-lai-sau-khi-qua-7-tab-khac');

    // ===== Đăng nhập Admin — xem nút "↩️ Mở Lại" cho kỳ Đã chốt + Báo Cáo + Phân Quyền =====
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(200);
    await shot('kiemke-tab1-admin-thay-mo-lai');
    await page.click('[data-op="reopenKkPeriod"]');
    await page.waitForTimeout(200);
    await shot('kiemke-tab1-admin-mo-lai-thanh-cong');

    // 11) Báo Cáo quản trị — mục "📋 Kiểm Kê — Kỳ Kiểm Kê" dưới nhóm Vận Hành (MỚI nối đợt này).
    await page.evaluate(() => { switchTab('reports'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { const n = document.querySelector('[data-op="selectReportsNavL1"][data-arg0="vanHanh"]'); if (n) n.click(); });
    await page.waitForTimeout(150);
    await shot('baocao-mo-nhom-van-hanh');
    await page.evaluate(() => { const n = document.querySelector('[data-op="selectReportsNavL2"][data-arg0="stocktakeSessions"]'); if (n) n.click(); });
    await page.waitForTimeout(250);
    await shot('baocao-kiemke-ky-kiem-ke');

    // 12) Hướng Dẫn (Nghiệp Vụ) — mục "📋 Kiểm Kê" trong nhóm Vận Hành (MỚI nối đợt này).
    await page.evaluate(() => { switchTab('nghiepVu'); });
    await page.waitForTimeout(200);
    await page.evaluate(() => { const n = document.querySelector('[data-op="setNVActiveKey"][data-arg0="kiemKe"]'); if (n) n.click(); });
    await page.waitForTimeout(250);
    await shot('huongdan-kiemke');

    if (jsErrors.length) {
      console.error('⚠️ CÓ LỖI JS (pageerror):\n' + jsErrors.join('\n'));
    } else {
      console.log('✅ Không có lỗi JS (pageerror) nào trong suốt demo.');
    }
    console.log(`\n==== Đã chụp ${n} ảnh vào ${OUT_DIR} ====`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
