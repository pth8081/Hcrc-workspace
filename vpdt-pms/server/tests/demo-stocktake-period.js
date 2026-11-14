// tests/demo-stocktake-period.js — demo Playwright THẬT cho module "📋 Kiểm Kê" Tab 1 "Kỳ Kiểm Kê"
// (Phase 1 MVP, 11/2026): tạo kỳ (Nháp) -> Kích Hoạt -> Đóng Kỳ -> Mở Lại (chỉ Admin), cùng kiểm tra
// phân quyền (kiemKePeriodManage) thật qua nút bấm, không chỉ gọi hàm nội bộ.
// Chạy: node server/tests/demo-stocktake-period.js
'use strict';
const assert = require('assert');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8993;

(async () => {
  const MANAGER = { username: 'qlA', name: 'Quản Lý Kiểm Kê', dept: 'Siêu thị Quận 1', perms: { kiemKePeriodManage: true }, active: true, totpEnabled: true };
  // PLAIN có kiemKeGomMaDo (được vào module Vận Hành + xem Tab 1 Kỳ Kiểm Kê — cần để biết kỳ nào đang
  // hoạt động trước khi Gom Mã) nhưng KHÔNG có kiemKePeriodManage — đúng vai thật "nhân viên quầy chỉ
  // quét, không quản lý kỳ", không phải trường hợp "không liên quan gì tới Kiểm Kê" (test riêng).
  const PLAIN = { username: 'nvB', name: 'Nhân Viên Thường', dept: 'Siêu thị Quận 1', perms: { kiemKeGomMaDo: true }, active: true, totpEnabled: true };
  const ADMIN = { username: 'admin', name: 'Admin', dept: 'Siêu thị Quận 1', perms: { admin: true }, active: true, totpEnabled: true };
  const state = createMockState({ depts: ['Siêu thị Quận 1'], stores: ['Siêu thị Quận 1'], users: [MANAGER, PLAIN, ADMIN] });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  page.on('dialog', (dialog) => dialog.accept());
  const jsErrors = [];
  page.on('pageerror', (err) => jsErrors.push('[pageerror] ' + (err && err.stack || String(err))));

  try {
    // ===== 1) Đăng nhập người KHÔNG có kiemKePeriodManage — thấy tab Kiểm Kê (module access default
    // ON) nhưng KHÔNG thấy nút "+ Tạo Kỳ Mới" (phải có quyền thật mới thao tác, không chỉ thấy tab). =====
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, PLAIN);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(200);
    const createBtnVisiblePlain = await page.isVisible('#btnKkPeriodOpenCreate');
    assert.strictEqual(createBtnVisiblePlain, false, 'LỖI: người KHÔNG có kiemKePeriodManage không được thấy nút "+ Tạo Kỳ Mới"');
    console.log('PASS: Người không có quyền kiemKePeriodManage không thấy nút Tạo Kỳ Mới');

    // Thử gọi API trực tiếp (giả lập cố bỏ qua UI) — PHẢI bị 403 ở server, không chỉ ẩn nút phía client.
    const directCreateStatus = await page.evaluate(async () => {
      const res = await fetch('/api/stocktake/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loaiKy: 'GOM_MA', tenKy: 'Cố tạo trái phép' }) });
      return res.status;
    });
    assert.strictEqual(directCreateStatus, 403, 'LỖI NGHIÊM TRỌNG: server phải chặn 403 khi KHÔNG có kiemKePeriodManage, không chỉ ẩn nút phía client');
    console.log('PASS: Server chặn 403 khi gọi thẳng API tạo kỳ mà không có quyền (không chỉ ẩn nút UI)');

    // ===== 2) Đăng nhập Quản Lý (có kiemKePeriodManage) — tạo kỳ Gom Mã mới, Nháp. =====
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, MANAGER);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(200);
    assert.strictEqual(await page.isVisible('#btnKkPeriodOpenCreate'), true, 'LỖI: Quản Lý có kiemKePeriodManage phải thấy nút Tạo Kỳ Mới');
    await page.click('#btnKkPeriodOpenCreate');
    await page.selectOption('#kkNewLoaiKy', 'GOM_MA');
    await page.fill('#kkNewTenKy', 'Gom Mã tuần 46/2026');
    await page.click('[data-op="submitCreateKkPeriod"]');
    await page.waitForTimeout(250);
    let rowText = await page.textContent('#kkPeriodListBody');
    assert.ok(rowText.includes('Gom Mã tuần 46/2026'), 'LỖI: kỳ mới tạo phải hiện trong danh sách');
    assert.ok(rowText.includes('Nháp'), 'LỖI: kỳ mới tạo phải ở trạng thái Nháp');
    console.log('PASS: Quản Lý tạo được Kỳ Gom Mã mới, đúng trạng thái Nháp');

    // ===== 3) Kích hoạt kỳ — chuyển Đang hoạt động, nút đổi thành "Đóng Kỳ". =====
    await page.click('[data-op="activateKkPeriod"]');
    await page.waitForTimeout(250);
    rowText = await page.textContent('#kkPeriodListBody');
    assert.ok(rowText.includes('Đang hoạt động'), 'LỖI: sau khi Kích Hoạt phải chuyển trạng thái Đang hoạt động');
    assert.strictEqual(await page.isVisible('[data-op="closeKkPeriod"]'), true, 'LỖI: kỳ Đang hoạt động phải có nút Đóng Kỳ');
    console.log('PASS: Kích Hoạt chuyển kỳ sang Đang hoạt động, hiện nút Đóng Kỳ');

    // ===== 4) Tạo thêm 1 kỳ Gom Mã thứ 2 cho ĐÚNG siêu thị này khi kỳ đầu đang Đang hoạt động — PHẢI bị
    // chặn NGAY LÚC TẠO (12/2026, SIẾT LẠI theo yêu cầu người dùng "trong 1 kỳ kiểm kê chỉ được 1 lần,
    // trừ khi đóng kỳ rồi mở lại" — TRƯỚC ĐÂY chỉ chặn muộn lúc Kích Hoạt, tạo được thoải mái nhiều bản
    // Nháp chồng nhau), có thông báo rõ ràng, KHÔNG tạo ra bản ghi rác trong danh sách. =====
    await page.click('#btnKkPeriodOpenCreate');
    await page.selectOption('#kkNewLoaiKy', 'GOM_MA');
    await page.fill('#kkNewTenKy', 'Gom Mã tuần 47 (trùng loại)');
    await page.click('[data-op="submitCreateKkPeriod"]');
    await page.waitForTimeout(200);
    const alertsAfterConflict = await page.evaluate(() => window.__alerts || []);
    assert.ok(alertsAfterConflict.some(a => a.includes('chưa đóng')), 'LỖI: phải cảnh báo rõ đã có 1 kỳ Gom Mã khác CHƯA ĐÓNG, chặn ngay lúc tạo');
    rowText = await page.textContent('#kkPeriodListBody');
    assert.ok(!rowText.includes('Gom Mã tuần 47 (trùng loại)'), 'LỖI: kỳ bị chặn tạo không được xuất hiện trong danh sách');
    console.log('PASS: Chặn đúng NGAY LÚC TẠO khi siêu thị đã có 1 kỳ CÙNG loại CHƯA ĐÓNG, có cảnh báo rõ, không tạo bản ghi rác');

    // ===== 5) Đóng kỳ đang hoạt động — chuyển Đã chốt, Quản Lý (không phải Admin) KHÔNG thấy nút Mở Lại. =====
    await page.click('[data-op="closeKkPeriod"]');
    await page.waitForTimeout(250);
    rowText = await page.textContent('#kkPeriodListBody');
    assert.ok(rowText.includes('Đã chốt'), 'LỖI: sau khi Đóng Kỳ phải chuyển trạng thái Đã chốt');
    assert.strictEqual(await page.isVisible('[data-op="reopenKkPeriod"]'), false, 'LỖI: Quản Lý (không phải Admin) KHÔNG được thấy nút Mở Lại Kỳ');
    console.log('PASS: Đóng Kỳ chuyển sang Đã chốt; Quản Lý (không phải Admin) không thấy nút Mở Lại');

    // Server cũng phải chặn — gọi thẳng API reopen bằng quyền Quản Lý (không phải admin) phải 403.
    const idClosed = await page.evaluate(() => kkPeriodSessionsCache.find(s => s.trangThai === 'DA_CHOT')?.id);
    const reopenByManagerStatus = await page.evaluate(async (id) => {
      const res = await fetch(`/api/stocktake/sessions/${id}/reopen`, { method: 'POST' });
      return res.status;
    }, idClosed);
    assert.strictEqual(reopenByManagerStatus, 403, 'LỖI NGHIÊM TRỌNG: server phải chặn 403 khi Quản Lý (không phải Admin) gọi thẳng API Mở Lại Kỳ');
    console.log('PASS: Server chặn 403 khi không phải Admin gọi thẳng API Mở Lại Kỳ đã chốt');

    // ===== 6) Đăng nhập Admin — thấy nút Mở Lại, mở lại thành công, quay về Đang hoạt động. =====
    await page.evaluate(async (u) => { window.__resetCapture && window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('vanHanh'); });
    await page.click('[data-op="setVanHanhSubTab"][data-tab="STOCKTAKE"]');
    await page.waitForTimeout(200);
    assert.strictEqual(await page.isVisible('[data-op="reopenKkPeriod"]'), true, 'LỖI: Admin phải thấy nút Mở Lại Kỳ cho kỳ Đã chốt');
    await page.click('[data-op="reopenKkPeriod"]');
    await page.waitForTimeout(250);
    rowText = await page.textContent('#kkPeriodListBody');
    assert.ok(rowText.includes('Đang hoạt động'), 'LỖI: sau khi Admin Mở Lại Kỳ phải quay về Đang hoạt động');
    console.log('PASS: Admin mở lại được kỳ Đã chốt, quay về Đang hoạt động');

    // ===== 7) Bộ lọc loại kỳ hoạt động đúng. =====
    await page.click('[data-op="setKkPeriodLoaiFilter"][data-arg0="THONG_KE"]');
    await page.waitForTimeout(150);
    rowText = await page.textContent('#kkPeriodListBody');
    assert.ok(!rowText.includes('Gom Mã tuần'), 'LỖI: lọc "Thống Kê" vẫn phải ẩn hết các kỳ Gom Mã');
    console.log('PASS: Bộ lọc Loại Kỳ ẩn đúng các kỳ không khớp');

    assert.strictEqual(jsErrors.length, 0, 'LỖI: có lỗi JS phát sinh: ' + jsErrors.join('\n'));
    console.log('PASS: Không có lỗi console.error/pageerror nào trong suốt quá trình thao tác THẬT');

    console.log('\n==== 9/9 scenario(s) passed ====');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((err) => { console.error(err); process.exit(1); });
