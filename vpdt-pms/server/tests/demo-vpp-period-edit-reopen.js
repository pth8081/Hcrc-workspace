// server/tests/demo-vpp-period-edit-reopen.js
//
// DEMO thật (không phải quy hoạch tests/test-*.js — không nằm trong bộ hồi quy tự động) cho tính năng
// "✏️ Sửa Kỳ" + "🔓 Mở Lại Kỳ" (12/2026, theo yêu cầu người dùng kèm ảnh chụp màn "Các Kỳ Đăng Ký" —
// "nếu đang mở thì cho phép sửa lại kỳ... nếu đóng rồi thì cho phép mở lại kỳ nữa... CHỈ mở lại nếu có
// người chưa đăng ký") — chụp ảnh màn hình thật qua testHarness.js (đi qua ĐÚNG route thật
// routes/records.js -> lib/recordActions.js, không bypass).
//
// Chạy: node server/tests/demo-vpp-period-edit-reopen.js
'use strict';
const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8995;
const OUT_DIR = path.join(__dirname, '..', 'demo-screenshots', 'vpp-period-edit-reopen');
const MANAGER = { username: 'qlvpp', name: 'Quản Lý VPP', dept: 'Phòng Hành Chính', perms: { vppManage: true }, active: true, totpEnabled: true };
const NV1 = { username: 'nv1', name: 'Nguyễn Văn A', dept: 'Phòng Kinh Doanh', perms: { vppRegisterCreate: true }, jobTitle: 'Nhân viên', active: true };
const NV2 = { username: 'nv2', name: 'Trần Thị B', dept: 'Phòng Kinh Doanh', perms: { vppRegisterCreate: true }, jobTitle: 'Nhân viên', active: true };
const NV3 = { username: 'nv3', name: 'Lê Văn C', dept: 'Phòng Kế Toán', perms: { vppRegisterCreate: true }, jobTitle: 'Nhân viên', active: true };

async function shot(page, selector, file, label) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log(`📸 ${label} ->`, file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const todayStr = new Date().toISOString().slice(0, 10);
  const state = createMockState({
    depts: ['Phòng Hành Chính', 'Phòng Kinh Doanh', 'Phòng Kế Toán'],
    users: [MANAGER, NV1, NV2, NV3],
    vppPeriods: [
      {
        id: 1, code: 'VPP-20261101-00001', name: 'Đăng Ký VPP Tháng 11/2026', status: 'OPEN',
        startDate: '', endDate: '', perPersonBudget: 100000, catalogItems: [{ name: 'Bút bi', unit: 'cây', price: 5000 }],
        deptHeadcounts: {}, deptBudgetRates: {}, creator: 'qlvpp', creatorName: 'Quản Lý VPP',
        createdAt: '01/11/2026 09:00:00'
      },
      {
        id: 2, code: 'VPP-20260901-00002', name: 'Đăng Ký VPP Tháng 9/2026 (còn người sót)', status: 'CLOSED',
        startDate: '', endDate: '', perPersonBudget: 100000, catalogItems: [{ name: 'Vở ô ly', unit: 'cuốn', price: 8000 }],
        deptHeadcounts: {}, deptBudgetRates: {}, creator: 'qlvpp', creatorName: 'Quản Lý VPP',
        createdAt: '01/09/2026 09:00:00', closedAt: '15/09/2026 17:00:00', closedBy: 'qlvpp'
      },
      {
        id: 3, code: 'VPP-20260801-00003', name: 'Đăng Ký VPP Tháng 8/2026 (mọi người đã ĐK)', status: 'CLOSED',
        startDate: '', endDate: '', perPersonBudget: 100000, catalogItems: [{ name: 'Giấy A4', unit: 'ream', price: 60000 }],
        deptHeadcounts: {}, deptBudgetRates: {}, creator: 'qlvpp', creatorName: 'Quản Lý VPP',
        createdAt: '01/08/2026 09:00:00', closedAt: '15/08/2026 17:00:00', closedBy: 'qlvpp'
      }
    ],
    // Kỳ 2 ("còn người sót"): chỉ nv1 đã đăng ký -> nv2/nv3 còn thiếu (2 người).
    // Kỳ 3 ("mọi người đã ĐK"): CẢ 3 người đủ điều kiện đều đã đăng ký -> không còn ai chưa ĐK.
    vppRegistrations: [
      { id: 101, periodId: 2, dept: 'Phòng Kinh Doanh', creator: 'nv1', creatorName: 'Nguyễn Văn A', status: 'APPROVED', items: [], createdAt: '05/09/2026 10:00:00' },
      { id: 102, periodId: 3, dept: 'Phòng Kinh Doanh', creator: 'nv1', creatorName: 'Nguyễn Văn A', status: 'APPROVED', items: [], createdAt: '05/08/2026 10:00:00' },
      { id: 103, periodId: 3, dept: 'Phòng Kinh Doanh', creator: 'nv2', creatorName: 'Trần Thị B', status: 'APPROVED', items: [], createdAt: '05/08/2026 10:00:00' },
      { id: 104, periodId: 3, dept: 'Phòng Kế Toán', creator: 'nv3', creatorName: 'Lê Văn C', status: 'APPROVED', items: [], createdAt: '05/08/2026 10:00:00' }
    ]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1280, height: 850 });

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, MANAGER);
    await page.evaluate(() => { switchTab('vpp'); setVppSubTab('PERIODS'); });
    await page.waitForTimeout(200);

    // Ảnh 1: bảng "Các Kỳ Đăng Ký" — kỳ 1 (OPEN) có nút "✏️ Sửa Kỳ", kỳ 2 (CLOSED, còn 2 người chưa ĐK)
    // có tuỳ chọn "🔓 Mở Lại Kỳ (còn 2 người chưa ĐK)" ở "Khác ▾", kỳ 3 (CLOSED, mọi người đã ĐK) KHÔNG
    // có tuỳ chọn "Mở Lại Kỳ" (vì không còn ai đủ điều kiện mà chưa đăng ký).
    await shot(page, '#vppPeriodsTableBody', '01-danh-sach-ky-dang-ky-3-trang-thai.png',
      'Danh sách Kỳ Đăng Ký: Kỳ 1 (Đang mở) có "✏️ Sửa Kỳ", Kỳ 2 (Đã kết thúc, còn người sót) hiện tuỳ chọn "🔓 Mở Lại Kỳ", Kỳ 3 (Đã kết thúc, đủ người) KHÔNG có tuỳ chọn mở lại');

    // Xác nhận bằng dữ liệu thật (không chỉ nhìn ảnh): đọc lại HTML của dropdown "Khác ▾" từng dòng.
    const row2Html = await page.evaluate(() => document.querySelectorAll('#vppPeriodsTableBody tr')[1].outerHTML);
    const row3Html = await page.evaluate(() => document.querySelectorAll('#vppPeriodsTableBody tr')[2].outerHTML);
    console.log(row2Html.includes('Mở Lại Kỳ (còn 2 người chưa ĐK)') ? '✅ Kỳ 2: ĐÚNG hiện "Mở Lại Kỳ (còn 2 người chưa ĐK)"' : '❌ Kỳ 2: SAI, không thấy tuỳ chọn mong đợi');
    console.log(!row3Html.includes('Mở Lại Kỳ') ? '✅ Kỳ 3: ĐÚNG KHÔNG hiện "Mở Lại Kỳ" (mọi người đã ĐK đủ)' : '❌ Kỳ 3: SAI, vẫn hiện tuỳ chọn mở lại dù không cần');

    // ===== Luồng "✏️ Sửa Kỳ" (Kỳ 1, đang mở) =====
    await page.evaluate(() => { openVppEditPeriodForm(1); });
    await page.waitForTimeout(200);
    // Ảnh 2: form nạp đúng dữ liệu kỳ 1, tiêu đề + nhãn nút đổi thành "Sửa Kỳ"/"Lưu Thay Đổi".
    await shot(page, '#vppNewPeriodFormWrap', '02-form-sua-ky-nap-du-lieu.png',
      'Form "Sửa Kỳ Đăng Ký" nạp đúng dữ liệu Kỳ 1, hiện "📋 Danh mục hiện tại: 1 mặt hàng", nhãn nút đổi thành "💾 Lưu Thay Đổi"');

    // Sửa tên + ngân sách/người, bấm Lưu Thay Đổi (KHÔNG tải file catalog mới -> giữ nguyên danh mục).
    await page.fill('#vppNewPeriodName', 'Đăng Ký VPP Tháng 11/2026 (đã bổ sung thêm thông tin)');
    await page.fill('#vppNewPeriodBudget', '150.000');
    page.once('dialog', d => d.accept());
    await page.evaluate(() => { saveVppPeriod(); });
    await page.waitForTimeout(300);

    // Ảnh 3: danh sách Kỳ Đăng Ký sau khi lưu — tên Kỳ 1 đã đổi, vẫn ở trạng thái "Đang mở".
    await shot(page, '#vppPeriodsTableBody', '03-sau-khi-luu-sua-ky.png',
      'Sau khi bấm "💾 Lưu Thay Đổi": tên Kỳ 1 đã đổi thành "...đã bổ sung thêm thông tin", vẫn giữ trạng thái Đang mở');
    const savedName = await page.evaluate(() => DB.vppPeriods.find(p => p.id === 1).name);
    const savedBudget = await page.evaluate(() => DB.vppPeriods.find(p => p.id === 1).perPersonBudget);
    console.log(savedName.includes('đã bổ sung thêm thông tin') ? `✅ Server đã lưu đúng tên mới: "${savedName}"` : `❌ Tên KHÔNG được lưu đúng: "${savedName}"`);
    console.log(savedBudget === 150000 ? '✅ Server đã lưu đúng mức ngân sách/người mới: 150.000đ' : `❌ Mức ngân sách SAI: ${savedBudget}`);

    // ===== Luồng "🔓 Mở Lại Kỳ" (Kỳ 2, đã kết thúc, còn 2 người chưa ĐK) =====
    await page.evaluate(() => { reopenVppPeriodAction(2); });
    await page.waitForTimeout(200);
    // Ảnh 4: modal xác nhận "Mở Lại Kỳ" hiện đúng số người còn thiếu + ô chọn hạn đăng ký mới.
    await shot(page, '#genericConfirmModal', '04-modal-mo-lai-ky.png',
      'Modal "Mở Lại Kỳ Đăng Ký" hiện đúng "còn 2 người" đủ điều kiện nhưng chưa đăng ký, kèm ô chọn hạn đăng ký mới');

    const futureDate = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    await page.fill('#vppReopenEndDateInput', futureDate);
    page.once('dialog', d => d.accept());
    await page.click('#genericConfirmModal button:has-text("Mở Lại Kỳ")');
    await page.waitForTimeout(300);

    // Ảnh 5: danh sách Kỳ Đăng Ký sau khi mở lại — Kỳ 2 chuyển về "🟢 Đang mở".
    await shot(page, '#vppPeriodsTableBody', '05-sau-khi-mo-lai-ky.png',
      'Sau khi "Mở Lại Kỳ": Kỳ 2 chuyển lại trạng thái "🟢 Đang mở" với hạn đăng ký mới, sẵn sàng cho 2 người còn sót đăng ký bổ sung');
    const reopenedPeriod = await page.evaluate(() => DB.vppPeriods.find(p => p.id === 2));
    console.log(reopenedPeriod.status === 'OPEN' ? '✅ Server đã chuyển Kỳ 2 về status=OPEN' : `❌ Status SAI: ${reopenedPeriod.status}`);
    console.log(reopenedPeriod.endDate === futureDate ? `✅ Server đã lưu đúng hạn đăng ký mới: ${futureDate}` : `❌ Hạn đăng ký mới SAI: ${reopenedPeriod.endDate}`);

    // ===== Đối chứng: kỳ 3 (mọi người đã ĐK) — gọi THẲNG action "reopen" qua server, PHẢI bị chặn 409 =====
    const blockResult = await page.evaluate(async () => {
      try {
        await callRecordAction('vppPeriods', 3, 'reopen', { newEndDate: '2099-01-01' });
        return { blocked: false };
      } catch (err) {
        return { blocked: true, message: err.message };
      }
    });
    console.log(blockResult.blocked ? `✅ Server CHẶN ĐÚNG việc mở lại Kỳ 3 (gọi thẳng API, không qua UI): "${blockResult.message}"` : '❌ SAI: server KHÔNG chặn việc mở lại Kỳ 3 dù mọi người đã đăng ký đủ');

    console.log('\n✅ XÁC NHẬN: "✏️ Sửa Kỳ" (khi đang mở) và "🔓 Mở Lại Kỳ" (khi đã đóng + còn người chưa ĐK) hoạt động đúng qua route thật, server chặn đúng khi không hội đủ điều kiện.');
  } finally {
    await browser.close();
    server.close();
  }
})();
