// server/tests/test-giai-doan-3-batch-b-badges.js
//
// Regression test cho Giai đoạn 3 "HCRC Workspace Refresh" (11/2026), batch B — badge trạng thái ở 3
// module (Onboarding/Offboarding, HCRC Đồng Hành, Báo Cáo Định Kỳ) đổi sang .badge-* DÙNG CHUNG, cùng
// khuôn các batch trước. Gọi thẳng các hàm/object badge (không cần dựng cả bảng) vì mỗi badge chỉ tra
// theo key hoặc nhận 1 object nhỏ, không phụ thuộc workflow/DB phức tạp.
//
// Chạy: node server/tests/test-giai-doan-3-batch-b-badges.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual } = require('./testHarness');

const PORT_UI = 8990;

async function main() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };
  const run = createRunner();

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({ users: [ADMIN] });
  const { browser, page } = await launchPage(PORT_UI, state);
  await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);

  await run.run('Onboarding/Offboarding: HR_TASK_STATUS_BADGES — 4 trạng thái đúng class dùng chung', async () => {
    const result = await page.evaluate(() => ({
      pending: HR_TASK_STATUS_BADGES.PENDING,
      done: HR_TASK_STATUS_BADGES.DONE,
      overdue: HR_TASK_STATUS_BADGES.OVERDUE,
      skipped: HR_TASK_STATUS_BADGES.SKIPPED
    }));
    assertEqual(result.pending.includes('badge-neutral'), true, 'PENDING (chưa làm) phải dùng badge-neutral');
    assertEqual(result.done.includes('badge-success'), true, 'DONE phải dùng badge-success');
    assertEqual(result.overdue.includes('badge-danger'), true, 'OVERDUE phải dùng badge-danger');
    assertEqual(result.skipped.includes('badge-neutral'), true, 'SKIPPED (đã bỏ qua) phải dùng badge-neutral');
  });

  await run.run('Onboarding/Offboarding: HR_PROCESS_STATUS_BADGES — 3 trạng thái đúng class dùng chung', async () => {
    const result = await page.evaluate(() => ({
      inProgress: HR_PROCESS_STATUS_BADGES.IN_PROGRESS,
      completed: HR_PROCESS_STATUS_BADGES.COMPLETED,
      cancelled: HR_PROCESS_STATUS_BADGES.CANCELLED
    }));
    assertEqual(result.inProgress.includes('badge-info'), true, 'IN_PROGRESS phải dùng badge-info');
    assertEqual(result.completed.includes('badge-success'), true, 'COMPLETED phải dùng badge-success');
    assertEqual(result.cancelled.includes('badge-danger'), true, 'CANCELLED phải dùng badge-danger');
  });

  await run.run('HCRC Đồng Hành: HR_FEEDBACK_STATUS_BADGES — 3 trạng thái đúng class dùng chung', async () => {
    const result = await page.evaluate(() => ({
      pending: HR_FEEDBACK_STATUS_BADGES.PENDING,
      answered: HR_FEEDBACK_STATUS_BADGES.ANSWERED,
      withdrawn: HR_FEEDBACK_STATUS_BADGES.WITHDRAWN
    }));
    assertEqual(result.pending.includes('badge-info'), true, 'PENDING (chờ phản hồi) phải dùng badge-info');
    assertEqual(result.answered.includes('badge-success'), true, 'ANSWERED phải dùng badge-success');
    assertEqual(result.withdrawn.includes('badge-neutral'), true, 'WITHDRAWN (đã rút lại) phải dùng badge-neutral');
  });

  await run.run('Báo Cáo Định Kỳ: prEntryStatusBadge() — Nháp/Đã gửi đúng class dùng chung', async () => {
    const result = await page.evaluate(() => ({
      draft: prEntryStatusBadge({ status: 'DRAFT' }),
      submitted: prEntryStatusBadge({ status: 'SUBMITTED' })
    }));
    assertEqual(result.draft.includes('badge-neutral'), true, 'DRAFT (Nháp chưa gửi) phải dùng badge-neutral');
    assertEqual(result.submitted.includes('badge-success'), true, 'Đã gửi phải dùng badge-success');
  });

  await run.run('Báo Cáo Định Kỳ: prPeriodStatusBadge() — 4 trạng thái kỳ đúng class dùng chung', async () => {
    const result = await page.evaluate(() => ({
      open: prPeriodStatusBadge({ status: 'OPEN', endTime: '2099-01-01T00:00:00.000Z' }),
      published: prPeriodStatusBadge({ status: 'CLOSED', compilation: { status: 'PUBLISHED' } }),
      merged: prPeriodStatusBadge({ status: 'CLOSED', compilation: { status: 'MERGED' } }),
      closed: prPeriodStatusBadge({ status: 'CLOSED' })
    }));
    assertEqual(result.open.includes('badge-success'), true, 'Đang mở phải dùng badge-success');
    assertEqual(result.published.includes('badge-success'), true, 'Đã phát hành phải dùng badge-success');
    assertEqual(result.merged.includes('badge-info'), true, 'Đã tổng hợp (đang xử lý tiếp) phải dùng badge-info');
    assertEqual(result.closed.includes('badge-neutral'), true, 'Đã kết thúc (chưa xử lý gì) phải dùng badge-neutral');
  });

  await browser.close();
  server.close();
  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
