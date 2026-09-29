// tests/test-csp-nested-root-double-dispatch.js
//
// LỖI ĐÃ VÁ (9/2026, người dùng báo nút "Đóng Tin"/"Xác Nhận Đã Tuyển Đủ"/"Xoá" ở khu Tuyển Dụng hỏi xác
// nhận 2 lần + gọi API 2 lần): #internalRecruitmentSection/#internalTrainingLmsSection/#paymentSection +
// 8 modal Đào Tạo/Tuyển Dụng đều LỒNG bên trong 1 gốc CSP delegation khác đã bind sẵn (#internalSection/
// #officeSection) — bind CSP delegation THÊM riêng cho các id con này (như code cũ làm) khiến 1 click bị
// bắt 2 LẦN (bubbling qua cả 2 gốc lồng nhau). Đã gỡ hết các dòng bind riêng dư thừa này khỏi core.js
// (xem chú thích chi tiết tại từng bindCspDelegation() đã xoá + NESTED_CSP_ROOTS_IN_FRAGMENT = {}).
//
// File này khoá lại đúng 3 kịch bản đã xác nhận double-dispatch trước khi vá (Tuyển Dụng/Đào Tạo LMS/
// Thanh Toán) — mỗi kịch bản phải đúng 1 LẦN dispatch, không phải 0 (bị mất listener) và không phải 2
// (double-dispatch quay lại).
//
// Chạy: node tests/test-csp-nested-root-double-dispatch.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual } = require('./testHarness');

const PORT = 8994;
const ADMIN = { username: 'admin', name: 'Quản Trị', dept: 'IT', perms: { admin: true }, active: true, totpEnabled: true };

async function main() {
  const run = createRunner();

  await run.run('Tuyển Dụng (#internalRecruitmentSection lồng trong #internalSection): click "Đóng Tin" chỉ gọi confirm() đúng 1 lần', async () => {
    const state = createMockState({
      users: [ADMIN],
      recruitmentJobs: [{ id: 1, title: 'Test Job', status: 'OPEN', dept: 'IT', hiringDept: 'IT', creator: 'admin' }]
    });
    const server = await startStaticServer(PORT);
    const { browser, page } = await launchPage(PORT, state);
    try {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
      await page.evaluate(async () => { await switchTab('internal'); });
      await page.waitForTimeout(300);
      await page.evaluate(async () => { setInternalSubTab && setInternalSubTab('RECRUITMENT'); });
      await page.waitForTimeout(200);
      const result = await page.evaluate(() => {
        let confirmCount = 0;
        window.confirm = () => { confirmCount++; return false; };
        const btn = document.querySelector('[data-op="closeRecruitmentJobUi"]');
        if (!btn) return { error: 'button not found' };
        btn.click();
        return { confirmCount };
      });
      assertEqual(result.error, undefined, 'phải tìm thấy nút "Đóng Tin"');
      assertEqual(result.confirmCount, 1, 'confirm() phải được gọi ĐÚNG 1 lần (không phải 0 hay 2)');
    } finally {
      await browser.close();
      server.close();
    }
  });

  await run.run('Đào Tạo LMS (#internalTrainingLmsSection lồng trong #internalSection): click "Xoá" chương trình chỉ gọi confirm() đúng 1 lần', async () => {
    const state = createMockState({
      users: [ADMIN],
      trainingCourses: [{ id: 1, name: 'Khoá học Test' }]
    });
    const server = await startStaticServer(PORT + 1);
    const { browser, page } = await launchPage(PORT + 1, state);
    try {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
      await page.evaluate(async () => { await switchTab('internal'); });
      await page.waitForTimeout(300);
      await page.evaluate(() => { setTrainingLmsTab && setTrainingLmsTab('COURSES'); });
      await page.waitForTimeout(200);
      const result = await page.evaluate(() => {
        let confirmCount = 0;
        window.confirm = () => { confirmCount++; return false; };
        const root = document.getElementById('internalTrainingLmsSection');
        const btn = root && root.querySelector('[data-op="deleteTrainingCourse"]');
        if (!btn) return { error: 'button not found' };
        btn.click();
        return { confirmCount };
      });
      assertEqual(result.error, undefined, 'phải tìm thấy nút "Xoá" chương trình');
      assertEqual(result.confirmCount, 1, 'confirm() phải được gọi ĐÚNG 1 lần (không phải 0 hay 2)');
    } finally {
      await browser.close();
      server.close();
    }
  });

  await run.run('Thanh Toán (#paymentSection lồng trong #officeSection): click "Xoá" đề nghị chỉ mở showConfirmModal() đúng 1 lần', async () => {
    const state = createMockState({
      users: [ADMIN],
      paymentRequests: [{ id: 1, dept: 'IT', creator: 'admin', status: 'PENDING', amount: 1000, title: 'test', purpose: 'test' }]
    });
    const server = await startStaticServer(PORT + 2);
    const { browser, page } = await launchPage(PORT + 2, state);
    try {
      await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, ADMIN);
      await page.evaluate(async () => { await switchTab('office'); });
      await page.waitForTimeout(300);
      await page.evaluate(() => { setOfficeSubTab && setOfficeSubTab('PAYMENT'); });
      await page.waitForTimeout(200);
      await page.evaluate(() => { setPaymentSubTab && setPaymentSubTab('MANAGE'); });
      await page.waitForTimeout(200);
      const result = await page.evaluate(() => {
        let clickCount = 0;
        window.showConfirmModal = () => { clickCount++; };
        const root = document.getElementById('paymentSection');
        const btn = root && root.querySelector('[data-op="deletePaymentRequestAction"]');
        if (!btn) return { error: 'button not found' };
        btn.click();
        return { clickCount };
      });
      assertEqual(result.error, undefined, 'phải tìm thấy nút "Xoá" đề nghị thanh toán');
      assertEqual(result.clickCount, 1, 'showConfirmModal() phải được gọi ĐÚNG 1 lần (không phải 0 hay 2)');
    } finally {
      await browser.close();
      server.close();
    }
  });

  run.summary();
}

main().catch((err) => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
