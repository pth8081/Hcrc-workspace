// server/tests/test-giai-doan-3-batch-d-badges.js
//
// Regression test cho Giai đoạn 3 "HCRC Workspace Refresh" (11/2026), batch D — 2 badge DÙNG CHUNG
// trong core.js (file nạp EAGER, dùng ở MỌI module): buildWorkflowStepsStatusHTML() (chi tiết từng bước
// duyệt, hiện trong modal của 7 module: Đăng Ký Xe/Phê Duyệt Giá/Văn Phòng/Hợp Đồng-Thanh Toán/Văn Bản
// Trình/Vận Hành/VPP) + badge Hộp Thư Chuyển Tiếp Xin Ý Kiến (renderForwardInbox()) đổi sang `.badge-*`.
// Batch này còn SỬA 1 LỆCH MÀU: "Đang chờ duyệt" ở buildWorkflowStepsStatusHTML() trước đây dùng vàng
// (amber), không khớp quy ước "đang chờ duyệt" = info (xanh dương) đã chuẩn hoá ở MỌI badge khác từ
// Giai đoạn 3a — nay đã đồng bộ lại đúng info.
//
// Chạy: node server/tests/test-giai-doan-3-batch-d-badges.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual } = require('./testHarness');

const PORT_UI = 8998;

async function main() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };
  const run = createRunner();

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({
    users: [ADMIN],
    submissions: [
      {
        id: 1, code: 'VBT-FWD', title: 'Văn bản trình chờ xin ý kiến', status: 'PENDING', dept: 'Phòng CNTT',
        creator: 'admin', currentStep: 1, history: [],
        forwardThreads: [{ forwardedTo: 'admin', forwardedBy: 'admin', forwardedAt: '18/10/2026 10:00:00', reply: null }]
      },
      {
        id: 2, code: 'VBT-FWD-DONE', title: 'Văn bản trình đã có phản hồi', status: 'PENDING', dept: 'Phòng CNTT',
        creator: 'admin', currentStep: 1, history: [],
        forwardThreads: [{ forwardedTo: 'admin', forwardedBy: 'admin', forwardedAt: '18/10/2026 10:00:00', reply: 'Đồng ý' }]
      },
      {
        id: 3, code: 'VBT-FWD-CLOSED', title: 'Văn bản trình đã xử lý xong', status: 'APPROVED', dept: 'Phòng CNTT',
        creator: 'admin', currentStep: 1, history: [],
        forwardThreads: [{ forwardedTo: 'admin', forwardedBy: 'admin', forwardedAt: '18/10/2026 10:00:00', reply: null }]
      }
    ]
  });
  const { browser, page } = await launchPage(PORT_UI, state);
  await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);

  await run.run('buildWorkflowStepsStatusHTML(): 5 trạng thái từng bước đều đúng class .badge-* dùng chung', async () => {
    const result = await page.evaluate(() => {
      const wf = { steps: [{ order: 1, name: 'Bước 1' }, { order: 2, name: 'Bước 2' }, { order: 3, name: 'Bước 3' }] };
      const rejected = buildWorkflowStepsStatusHTML(wf, [{ step: 1, action: 'REJECTED', approver: 'admin', time: 't' }], 1, 'REJECTED');
      const approved = buildWorkflowStepsStatusHTML(wf, [{ step: 1, action: 'APPROVED', approver: 'admin', time: 't' }], 2, 'PENDING');
      const pendingNow = buildWorkflowStepsStatusHTML(wf, [], 2, 'PENDING');
      const upcoming = buildWorkflowStepsStatusHTML(wf, [], 1, 'PENDING');
      return { rejected, approved, pendingNow, upcoming };
    });
    assertEqual(result.rejected.includes('badge-danger'), true, 'Từ chối phải dùng badge-danger');
    assertEqual(result.approved.includes('badge-success'), true, 'Đã duyệt phải dùng badge-success');
    assertEqual(result.pendingNow.includes('badge-info'), true, 'Đang chờ duyệt (bước hiện tại) phải dùng badge-info (ĐỔI từ vàng)');
    assertEqual(result.upcoming.includes('badge-neutral'), true, 'Sắp tới (chưa tới bước) phải dùng badge-neutral');
  });

  await run.run('buildWorkflowStepsStatusHTML(): không còn sót class Tailwind cũ', async () => {
    const stale = await page.evaluate(() => {
      const wf = { steps: [{ order: 1, name: 'B1' }, { order: 2, name: 'B2' }] };
      const html = buildWorkflowStepsStatusHTML(wf, [{ step: 1, action: 'APPROVED', approver: 'admin', time: 't' }], 2, 'PENDING');
      return /bg-(red|green|amber|gray)-\d00/.test(html);
    });
    assertEqual(stale, false, 'Không được còn sót class Tailwind cũ trong buildWorkflowStepsStatusHTML()');
  });

  await run.run('Hộp Thư Chuyển Tiếp Xin Ý Kiến: 3 trạng thái đều đúng class .badge-* dùng chung', async () => {
    await page.evaluate(() => {
      document.getElementById('forwardInboxModal')?.classList.remove('hidden');
      renderForwardInbox();
    });
    const rows = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('#forwardInboxList > div'));
      return divs.map(d => ({
        text: d.innerText,
        cls: d.querySelector('.badge-info, .badge-success, .badge-neutral')?.className || ''
      }));
    });
    const find = (needle) => rows.find(r => r.text.includes(needle));
    assertEqual(find('VBT-FWD')?.cls.includes('badge-info'), true, 'Chờ bạn phản hồi phải dùng badge-info');
    assertEqual(find('VBT-FWD-DONE')?.cls.includes('badge-success'), true, 'Đã phản hồi phải dùng badge-success');
    assertEqual(find('VBT-FWD-CLOSED')?.cls.includes('badge-neutral'), true, 'Hồ sơ đã xử lý xong (không còn chờ) phải dùng badge-neutral');
  });

  await browser.close();
  server.close();
  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
