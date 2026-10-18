// server/tests/test-giai-doan-3-batch-c-badges.js
//
// Regression test cho Giai đoạn 3 "HCRC Workspace Refresh" (11/2026), batch C — badge trạng thái ở
// Hộp Thư Duyệt Tổng Hợp (core-approvalhub.js) + Phê Duyệt Giá/Hỗ Trợ Yêu Cầu (module-itsupport-price.js)
// đổi sang .badge-* DÙNG CHUNG. Gọi thẳng các hàm/object badge (không cần dựng cả bảng).
//
// Chạy: node server/tests/test-giai-doan-3-batch-c-badges.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual } = require('./testHarness');

const PORT_UI = 8995;

async function main() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };
  const run = createRunner();

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({
    users: [ADMIN],
    docs: [
      { id: 1, code: 'DOC-APR', title: 'Tài liệu đã duyệt bởi admin', status: 'APPROVED', dept: 'Phòng CNTT', creator: 'admin', currentStep: 1, history: [{ username: 'admin', action: 'APPROVED', time: '18/10/2026 10:00:00' }] },
      { id: 2, code: 'DOC-REJ', title: 'Tài liệu bị admin từ chối', status: 'REJECTED', dept: 'Phòng CNTT', creator: 'admin', currentStep: 1, history: [{ username: 'admin', action: 'REJECTED', time: '18/10/2026 10:00:00' }] }
    ]
  });
  const { browser, page } = await launchPage(PORT_UI, state);
  await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);

  await run.run('Approval Hub: approvalHubPendingBadge() / approvalHubNeedInfoBadge() đúng class dùng chung', async () => {
    const result = await page.evaluate(() => ({
      pending: approvalHubPendingBadge(),
      needInfo: approvalHubNeedInfoBadge()
    }));
    assertEqual(result.pending.includes('badge-info'), true, 'Đang chờ duyệt phải dùng badge-info');
    assertEqual(result.needInfo.includes('badge-warning'), true, 'Chờ bổ sung phải dùng badge-warning');
  });

  await run.run('Approval Hub: getMyProcessedApprovals() — Đã Duyệt/Đã Từ Chối đúng class dùng chung', async () => {
    const result = await page.evaluate((u) => {
      const approved = getMyProcessedApprovals(u, 'APPROVED', 0);
      const rejected = getMyProcessedApprovals(u, 'REJECTED', 0);
      return {
        approvedBadge: approved.find(i => i.code === 'DOC-APR')?.statusBadge || null,
        rejectedBadge: rejected.find(i => i.code === 'DOC-REJ')?.statusBadge || null
      };
    }, ADMIN);
    assertEqual(result.approvedBadge?.includes('badge-success'), true, 'Đã Duyệt phải dùng badge-success');
    assertEqual(result.rejectedBadge?.includes('badge-danger'), true, 'Đã Từ Chối phải dùng badge-danger');
  });

  await run.run('Phê Duyệt Giá: itPriceStatusBadge() — REJECTED/APPROVED/chờ bổ sung/tự động duyệt đúng class dùng chung', async () => {
    const result = await page.evaluate(() => ({
      rejected: itPriceStatusBadge({ status: 'REJECTED' }),
      approved: itPriceStatusBadge({ status: 'APPROVED', infoRequests: [] }),
      approvedNeedInfo: itPriceStatusBadge({ status: 'APPROVED', infoRequests: [{ response: null }] }),
      autoApproved: itPriceStatusBadge({ status: 'APPROVED', infoRequests: [], autoApproved: true })
    }));
    assertEqual(result.rejected.includes('badge-danger'), true, 'REJECTED phải dùng badge-danger');
    assertEqual(result.approved.includes('badge-success'), true, 'APPROVED phải dùng badge-success');
    assertEqual(result.approvedNeedInfo.includes('badge-warning'), true, 'APPROVED + IT yêu cầu bổ sung phải dùng badge-warning');
    assertEqual(result.autoApproved.includes('badge-success'), true, 'Tự động duyệt phải dùng badge-success');
  });

  await run.run('Phê Duyệt Giá: itPriceAppliedBadge() — đã áp giá/đang xử lý/chưa áp giá đúng class dùng chung', async () => {
    const result = await page.evaluate(() => ({
      notApproved: itPriceAppliedBadge({ status: 'PENDING' }),
      applied: itPriceAppliedBadge({ status: 'APPROVED', applied: true }),
      claimed: itPriceAppliedBadge({ status: 'APPROVED', applied: false, applyClaimedBy: 'u1' }),
      none: itPriceAppliedBadge({ status: 'APPROVED', applied: false })
    }));
    assertEqual(result.applied.includes('badge-success'), true, 'Đã áp giá phải dùng badge-success');
    assertEqual(result.claimed.includes('badge-info'), true, 'Đang xử lý (đã nhận) phải dùng badge-info');
    assertEqual(result.none.includes('badge-warning'), true, 'Chưa áp giá phải dùng badge-warning');
  });

  await run.run('Hỗ Trợ Yêu Cầu: IT_TICKET_STATUS_BADGES + IT_TICKET_APPROVAL_BADGES đúng class dùng chung', async () => {
    const result = await page.evaluate(() => ({
      todo: IT_TICKET_STATUS_BADGES.TODO,
      doing: IT_TICKET_STATUS_BADGES.DOING,
      done: IT_TICKET_STATUS_BADGES.DONE,
      cancelled: IT_TICKET_STATUS_BADGES.CANCELLED,
      approvalPending: IT_TICKET_APPROVAL_BADGES.PENDING({ approvalApproverName: 'A' }),
      approvalApproved: IT_TICKET_APPROVAL_BADGES.APPROVED({ approvalApproverName: 'A' }),
      approvalRejected: IT_TICKET_APPROVAL_BADGES.REJECTED({ approvalApproverName: 'A' })
    }));
    assertEqual(result.todo.includes('badge-neutral'), true, 'TODO (chưa xử lý) phải dùng badge-neutral');
    assertEqual(result.doing.includes('badge-info'), true, 'DOING phải dùng badge-info');
    assertEqual(result.done.includes('badge-success'), true, 'DONE phải dùng badge-success');
    assertEqual(result.cancelled.includes('badge-danger'), true, 'CANCELLED phải dùng badge-danger');
    assertEqual(result.approvalPending.includes('badge-info'), true, 'Chờ duyệt leo thang phải dùng badge-info');
    assertEqual(result.approvalApproved.includes('badge-success'), true, 'Đã duyệt leo thang phải dùng badge-success');
    assertEqual(result.approvalRejected.includes('badge-danger'), true, 'Đã từ chối leo thang phải dùng badge-danger');
  });

  await browser.close();
  server.close();
  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
