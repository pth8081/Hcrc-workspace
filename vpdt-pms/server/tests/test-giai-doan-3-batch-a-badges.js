// server/tests/test-giai-doan-3-batch-a-badges.js
//
// Regression test cho Giai đoạn 3 "HCRC Workspace Refresh" (11/2026), batch A — badge trạng thái ở 3
// module (Mua Sắm/Sửa Chữa VP, Đơn Hàng Vận Hành, Dòng Ngân Sách) đổi sang .badge-* DÙNG CHUNG, cùng
// khuôn Giai đoạn 3a/3b. Gộp cả 3 module vào 1 file vì mỗi module chỉ có vài dòng badge đơn giản.
//
// Chạy: node server/tests/test-giai-doan-3-batch-a-badges.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual } = require('./testHarness');

const PORT_UI = 8986;

async function main() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };
  const run = createRunner();

  // ===== Mua Sắm/Sửa Chữa VP (officeReqs) =====
  {
    const server = await startStaticServer(PORT_UI);
    const state = createMockState({
      users: [ADMIN],
      officeReqs: [
        { id: 1, code: 'VP-001', subType: 'MUA_BAN', status: 'APPROVED', dept: 'Phòng CNTT', creator: 'admin', creatorName: 'Admin', title: 'Mua ghế', amount: 1000000, history: [], currentStep: 1 },
        { id: 2, code: 'VP-002', subType: 'MUA_BAN', status: 'REJECTED', dept: 'Phòng CNTT', creator: 'admin', creatorName: 'Admin', title: 'Mua bàn', amount: 1000000, history: [], currentStep: 1 },
        { id: 3, code: 'VP-003', subType: 'MUA_BAN', status: 'DRAFT', dept: 'Phòng CNTT', creator: 'admin', creatorName: 'Admin', title: 'Mua tủ', amount: 1000000, history: [], currentStep: 0 },
        { id: 4, code: 'VP-004', subType: 'MUA_BAN', status: 'CANCELLED', dept: 'Phòng CNTT', creator: 'admin', creatorName: 'Admin', title: 'Mua kệ', amount: 1000000, history: [], currentStep: 1 },
        { id: 5, code: 'VP-005', subType: 'MUA_BAN', status: 'PENDING', dept: 'Phòng CNTT', creator: 'admin', creatorName: 'Admin', title: 'Mua máy in', amount: 1000000, history: [], currentStep: 1 }
      ]
    });
    const { browser, page } = await launchPage(PORT_UI, state);
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('office'); });
    await page.waitForTimeout(150);

    await run.run('Mua Sắm/Sửa Chữa VP: 5 trạng thái đều render đúng class .badge-* dùng chung', async () => {
      const rows = await page.evaluate(() => {
        const trs = Array.from(document.querySelectorAll('#officeTableBody tr'));
        return trs.map(tr => ({
          text: tr.innerText,
          cls: tr.querySelector('.badge-info, .badge-success, .badge-danger, .badge-warning, .badge-neutral')?.className || null
        }));
      });
      const find = (needle) => rows.find(r => r.text.includes(needle));
      assertEqual(find('VP-001')?.cls, 'badge-success', 'APPROVED -> badge-success');
      assertEqual(find('VP-002')?.cls, 'badge-danger', 'REJECTED -> badge-danger');
      assertEqual(find('VP-003')?.cls, 'badge-warning', 'DRAFT (cần bổ sung) -> badge-warning');
      assertEqual(find('VP-004')?.cls, 'badge-danger', 'CANCELLED -> badge-danger');
      assertEqual(find('VP-005')?.cls, 'badge-info', 'PENDING (đang ở bước) -> badge-info');
    });

    await run.run('Mua Sắm/Sửa Chữa VP: không còn sót class Tailwind cũ', async () => {
      const stale = await page.evaluate(() => {
        const trs = Array.from(document.querySelectorAll('#officeTableBody tr'));
        return trs.some(tr => /bg-(green|red|orange|yellow|indigo|emerald|teal|cyan)-100|bg-slate-200/.test(tr.innerHTML));
      });
      assertEqual(stale, false, 'Không được còn sót class Tailwind cũ trong cột trạng thái VP');
    });

    await browser.close();
    server.close();
  }

  // ===== Đơn Hàng Vận Hành (operationOrders) — gọi thẳng operationStatusBadge() =====
  {
    const server = await startStaticServer(PORT_UI + 1);
    const state = createMockState({ users: [ADMIN] });
    const { browser, page } = await launchPage(PORT_UI + 1, state);
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);

    await run.run('Đơn Hàng Vận Hành: operationStatusBadge() — 6 trạng thái + đang ở bước đều đúng class dùng chung', async () => {
      const result = await page.evaluate(() => ({
        draft: operationStatusBadge({ status: 'DRAFT' }),
        awaiting: operationStatusBadge({ status: 'AWAITING_RECEIPT' }),
        received: operationStatusBadge({ status: 'RECEIVED' }),
        receiptCancelled: operationStatusBadge({ status: 'RECEIPT_CANCELLED' }),
        approved: operationStatusBadge({ status: 'APPROVED' }),
        rejected: operationStatusBadge({ status: 'REJECTED' }),
        pending: operationStatusBadge({ status: 'PENDING', currentStep: 1 })
      }));
      assertEqual(result.draft.includes('badge-warning'), true, 'DRAFT (cần bổ sung) phải dùng badge-warning');
      assertEqual(result.awaiting.includes('badge-info'), true, 'AWAITING_RECEIPT phải dùng badge-info');
      assertEqual(result.received.includes('badge-success'), true, 'RECEIVED phải dùng badge-success');
      assertEqual(result.receiptCancelled.includes('badge-danger'), true, 'RECEIPT_CANCELLED phải dùng badge-danger');
      assertEqual(result.approved.includes('badge-success'), true, 'APPROVED phải dùng badge-success');
      assertEqual(result.rejected.includes('badge-danger'), true, 'REJECTED phải dùng badge-danger');
      assertEqual(result.pending.includes('badge-info'), true, 'Đang ở bước phải dùng badge-info');
    });

    await browser.close();
    server.close();
  }

  // ===== Dòng Ngân Sách (budgetLines) — gọi thẳng 2 hàm helper =====
  {
    const server = await startStaticServer(PORT_UI + 2);
    const state = createMockState({ users: [ADMIN] });
    const { browser, page } = await launchPage(PORT_UI + 2, state);
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);

    await run.run('Dòng Ngân Sách: budgetLineStatusBadge() — 3 trạng thái đều đúng class dùng chung', async () => {
      const result = await page.evaluate(() => ({
        submitted: budgetLineStatusBadge({ status: 'SUBMITTED' }),
        approved: budgetLineStatusBadge({ status: 'APPROVED' }),
        rejected: budgetLineStatusBadge({ status: 'REJECTED' })
      }));
      assertEqual(result.submitted.includes('badge-info'), true, 'SUBMITTED phải dùng badge-info');
      assertEqual(result.approved.includes('badge-success'), true, 'APPROVED phải dùng badge-success');
      assertEqual(result.rejected.includes('badge-danger'), true, 'REJECTED phải dùng badge-danger');
    });

    await run.run('Dòng Ngân Sách: budgetLineUsageStatusBadge() — 4 mức sử dụng đều đúng class dùng chung', async () => {
      const result = await page.evaluate(() => ({
        over: budgetLineUsageStatusBadge('OVER_BUDGET'),
        used: budgetLineUsageStatusBadge('USED'),
        partial: budgetLineUsageStatusBadge('PARTIALLY_USED'),
        none: budgetLineUsageStatusBadge(undefined)
      }));
      assertEqual(result.over.includes('badge-danger'), true, 'OVER_BUDGET phải dùng badge-danger');
      assertEqual(result.used.includes('badge-success'), true, 'USED phải dùng badge-success');
      assertEqual(result.partial.includes('badge-warning'), true, 'PARTIALLY_USED phải dùng badge-warning');
      assertEqual(result.none.includes('badge-neutral'), true, 'Chưa dùng phải dùng badge-neutral');
    });

    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
