// server/tests/test-actionlabel-xss.js
//
// BUG THẬT đã vá (rà soát chuyên sâu sau v23.73 "Nhãn Phê Duyệt"): `approveLabel` (đọc từ
// step.actionLabel/resolveStepActionLabel(), CÓ THỂ do admin tự gõ tự do ở "🖋️ Nhóm Phê Duyệt Trình/HĐ"
// hoặc "🛠️ Định Nghĩa Các Mẫu Bước Phê Duyệt") được ghép thẳng KHÔNG escapeHtml() vào `bodyHTML` của
// showConfirmModal() — hàm này gán qua `.innerHTML` (core.js) — trong khi field `title`/`confirmLabel`
// đi qua `.innerText` nên an toàn. Nếu admin (hoặc ai chiếm được quyền ghi actionLabel) đặt nhãn dạng
// `<img src=x onerror=...>`, BẤT KỲ người duyệt nào (không cần là admin) mở modal xác nhận Duyệt cho
// bước đó đều bị chạy script trong phiên của họ — stored XSS qua ranh giới quyền (admin cấu hình,
// người duyệt thường trúng đòn). Đã vá escapeHtml() ở đúng điểm ghép vào bodyHTML tại 8 chỗ/6 module
// (module-vanbantrinh.js/module-hopdong.js x2/module-dangkyxe.js/module-office.js/module-vanhanh.js/
// module-vpp.js/module-thanhtoan.js) — bài test này xác nhận 3 module đại diện (Văn Bản Trình + Hợp
// Đồng dùng đúng tính năng Nhãn Phê Duyệt mới; Đăng Ký Xe dùng cơ chế actionLabel CŨ hơn/dùng chung để
// xác nhận bản vá áp dụng đúng khuôn chung, không riêng 1 module).
//
// Chạy: node server/tests/test-actionlabel-xss.js
'use strict';
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8992;
const MALICIOUS_LABEL = '<img src=x onerror="window.__xssFired = true">';

async function main() {
  const { server, browser, page } = await setup(PORT);
  const run = makeRunner();

  try {
    await run.run('module-vanbantrinh.js confirmProcessSubmission(): actionLabel độc hại KHÔNG thực thi được trong bodyHTML (escapeHtml đã vá)', async () => {
      await page.evaluate((label) => {
        window.__xssFired = false;
        currentUser = { username: 'nv1', name: 'Nhân Viên', dept: 'Phòng A', perms: {} };
        DB.submissions = [{
          id: 1, code: 'TT-001', currentStep: 1, status: 'PENDING',
          effectiveSteps: [{ order: 1, name: 'Bước 1', actionLabel: label }],
          effectiveApprovers: { 1: ['nv1'] }
        }];
        document.getElementById('txtSubmissionComment').value = '';
        currentProcessingSubId = 1;
        confirmProcessSubmission('APPROVE');
      }, MALICIOUS_LABEL);
      await page.waitForTimeout(50);
      const result = await page.evaluate(() => ({
        xssFired: window.__xssFired,
        bodyHTML: document.getElementById('genericConfirmBody').innerHTML,
        bodyHasRawImgTag: document.getElementById('genericConfirmBody').querySelector('img') !== null
      }));
      assert(result.xssFired === false, 'onerror của thẻ <img> độc hại KHÔNG được thực thi');
      assert(result.bodyHasRawImgTag === false, 'bodyHTML KHÔNG được chứa thẻ <img> THẬT (phải là chuỗi đã escape, hiện dạng &lt;img...&gt;)');
      assert(result.bodyHTML.includes('&lt;img'), 'bodyHTML phải chứa dạng ĐÃ ESCAPE của nhãn độc hại (&lt;img...)');
    });

    await run.run('module-hopdong.js approveContractAction(): actionLabel độc hại KHÔNG thực thi được trong bodyHTML (escapeHtml đã vá)', async () => {
      await page.evaluate((label) => {
        window.__xssFired = false;
        currentUser = { username: 'nv1', name: 'Nhân Viên', dept: 'Phòng A', perms: {} };
        DB.contracts = [{
          id: 2, code: 'HD-001', title: 'Hợp đồng test', currentStep: 1, status: 'PENDING', dept: 'Phòng A',
          effectiveSteps: [{ order: 1, name: 'Bước 1', actionLabel: label }],
          effectiveApprovers: { 1: ['nv1'] }
        }];
        approveContractAction(2);
      }, MALICIOUS_LABEL);
      await page.waitForTimeout(50);
      const result = await page.evaluate(() => ({
        xssFired: window.__xssFired,
        bodyHTML: document.getElementById('genericConfirmBody').innerHTML,
        bodyHasRawImgTag: document.getElementById('genericConfirmBody').querySelector('img') !== null
      }));
      assert(result.xssFired === false, 'onerror của thẻ <img> độc hại KHÔNG được thực thi');
      assert(result.bodyHasRawImgTag === false, 'bodyHTML KHÔNG được chứa thẻ <img> THẬT (phải là chuỗi đã escape)');
      assert(result.bodyHTML.includes('&lt;img'), 'bodyHTML phải chứa dạng ĐÃ ESCAPE của nhãn độc hại');
      // Đóng modal (Playwright dialog leftover an toàn cho scenario sau) + dọn state.
      await page.evaluate(() => closeGenericConfirmModal());
    });

    await run.run('module-dangkyxe.js confirmProcessCarReg(): actionLabel độc hại KHÔNG thực thi được trong bodyHTML (cùng khuôn chung, không riêng tính năng Nhãn Phê Duyệt)', async () => {
      await page.evaluate((label) => {
        window.__xssFired = false;
        currentUser = { username: 'nv1', name: 'Nhân Viên', dept: 'Phòng A', perms: {} };
        DB.workflows = [{ id: 'WF_XSS_TEST', name: 'Test', steps: [{ order: 1, name: 'Bước 1', actionLabel: label }] }];
        DB.carDeptWorkflows = { 'Phòng A': { workflowId: 'WF_XSS_TEST', approvers: { 1: ['nv1'] } } };
        DB.carRegs = [{ id: 3, code: 'DKX-001', currentStep: 1, status: 'PENDING', dept: 'Phòng A' }];
        document.getElementById('txtCarComment') && (document.getElementById('txtCarComment').value = '');
        currentProcessingCarId = 3;
        confirmProcessCarReg('APPROVE');
      }, MALICIOUS_LABEL);
      await page.waitForTimeout(50);
      const result = await page.evaluate(() => ({
        xssFired: window.__xssFired,
        bodyHTML: document.getElementById('genericConfirmBody').innerHTML,
        bodyHasRawImgTag: document.getElementById('genericConfirmBody').querySelector('img') !== null
      }));
      assert(result.xssFired === false, 'onerror của thẻ <img> độc hại KHÔNG được thực thi');
      assert(result.bodyHasRawImgTag === false, 'bodyHTML KHÔNG được chứa thẻ <img> THẬT (phải là chuỗi đã escape)');
      assert(result.bodyHTML.includes('&lt;img'), 'bodyHTML phải chứa dạng ĐÃ ESCAPE của nhãn độc hại');
    });

    run.summarize('test-actionlabel-xss');
  } finally {
    await teardown({ server, browser });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
