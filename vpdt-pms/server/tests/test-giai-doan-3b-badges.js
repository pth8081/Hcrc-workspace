// server/tests/test-giai-doan-3b-badges.js
//
// Regression test cho Giai đoạn 3b "HCRC Workspace Refresh" (11/2026) — badge trạng thái ở 3 module
// (Đăng Ký Xe, Phòng Họp, Văn Phòng Phẩm) đổi sang .badge-* DÙNG CHUNG, cùng khuôn Giai đoạn 3a (Tài
// liệu/Văn Bản Trình). Gộp cả 3 module vào 1 file test (thay vì 3 file riêng) vì mỗi module chỉ có vài
// dòng badge đơn giản, không đáng tách — khác hẳn Tài liệu/Văn Bản Trình/Công Việc/Dashboard (mỗi cái
// đã có sẵn 1 file test riêng từ trước, đủ phức tạp để tách).
//
// Chạy: node server/tests/test-giai-doan-3b-badges.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual } = require('./testHarness');

const PORT_UI = 8983;

async function main() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };
  const run = createRunner();

  // ===== Đăng Ký Xe =====
  {
    const server = await startStaticServer(PORT_UI);
    const state = createMockState({
      users: [ADMIN],
      workflows: [{ id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ name: 'Sếp duyệt' }] }],
      carRegs: [
        { id: 1, code: 'XE-001', status: 'APPROVED', dept: 'Phòng CNTT', creator: 'admin', currentStep: 1 },
        { id: 2, code: 'XE-002', status: 'IN_PROGRESS', dept: 'Phòng CNTT', creator: 'admin', currentStep: 1 },
        { id: 3, code: 'XE-003', status: 'AWAITING_EVALUATION', dept: 'Phòng CNTT', creator: 'admin', currentStep: 1 },
        { id: 4, code: 'XE-004', status: 'COMPLETED', dept: 'Phòng CNTT', creator: 'admin', currentStep: 1 },
        { id: 5, code: 'XE-005', status: 'REJECTED', dept: 'Phòng CNTT', creator: 'admin', currentStep: 1 },
        { id: 6, code: 'XE-006', status: 'CANCELLED', dept: 'Phòng CNTT', creator: 'admin', currentStep: 1 },
        { id: 7, code: 'XE-007', status: 'DRAFT', dept: 'Phòng CNTT', creator: 'admin', currentStep: 0 },
        { id: 8, code: 'XE-008', status: 'PENDING', dept: 'Phòng CNTT', creator: 'admin', currentStep: 1 }
      ]
    });
    const { browser, page } = await launchPage(PORT_UI, state);
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('car'); });
    await page.waitForTimeout(150);

    await run.run('Đăng Ký Xe: 8 trạng thái đều render đúng class .badge-* dùng chung', async () => {
      const rows = await page.evaluate(() => {
        const trs = Array.from(document.querySelectorAll('#carTableBody tr'));
        return trs.map(tr => ({
          text: tr.innerText,
          cls: tr.querySelector('.badge-info, .badge-success, .badge-danger, .badge-warning, .badge-neutral')?.className || null
        }));
      });
      const find = (needle) => rows.find(r => r.text.includes(needle));
      assertEqual(find('XE-001')?.cls, 'badge-success', 'APPROVED -> badge-success');
      assertEqual(find('XE-002')?.cls, 'badge-info', 'IN_PROGRESS -> badge-info');
      assertEqual(find('XE-003')?.cls, 'badge-warning', 'AWAITING_EVALUATION -> badge-warning');
      assertEqual(find('XE-004')?.cls, 'badge-success', 'COMPLETED -> badge-success');
      assertEqual(find('XE-005')?.cls, 'badge-danger', 'REJECTED -> badge-danger');
      assertEqual(find('XE-006')?.cls, 'badge-danger', 'CANCELLED -> badge-danger');
      assertEqual(find('XE-007')?.cls, 'badge-warning', 'DRAFT (cần bổ sung) -> badge-warning');
      assertEqual(find('XE-008')?.cls, 'badge-info', 'PENDING (đang ở bước) -> badge-info');
    });

    await run.run('Đăng Ký Xe: không còn sót class Tailwind cũ', async () => {
      const stale = await page.evaluate(() => {
        const trs = Array.from(document.querySelectorAll('#carTableBody tr'));
        return trs.some(tr => /bg-(green|red|orange|amber|indigo|emerald|slate)-100|bg-slate-200/.test(tr.innerHTML));
      });
      assertEqual(stale, false, 'Không được còn sót class Tailwind cũ trong cột trạng thái Đăng Ký Xe');
    });

    await browser.close();
    server.close();
  }

  // ===== Phòng Họp =====
  {
    const server = await startStaticServer(PORT_UI + 1);
    const state = createMockState({
      users: [ADMIN],
      meetings: [
        { id: 1, code: 'PH-001', status: 'APPROVED', room: 'Phòng A', dept: 'Phòng CNTT', creator: 'admin' },
        { id: 2, code: 'PH-002', status: 'CANCELLED', room: 'Phòng A', dept: 'Phòng CNTT', creator: 'admin' },
        { id: 3, code: 'PH-003', status: 'PENDING', room: 'Phòng A', dept: 'Phòng CNTT', creator: 'admin' }
      ]
    });
    const { browser, page } = await launchPage(PORT_UI + 1, state);
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('meeting'); });
    await page.waitForTimeout(150);

    await run.run('Phòng Họp: 3 trạng thái đều render đúng class .badge-* dùng chung', async () => {
      const rows = await page.evaluate(() => {
        const trs = Array.from(document.querySelectorAll('#meetingTableBody tr'));
        return trs.map(tr => ({
          text: tr.innerText,
          cls: tr.querySelector('.badge-info, .badge-success, .badge-danger')?.className || null
        }));
      });
      const find = (needle) => rows.find(r => r.text.includes(needle));
      assertEqual(find('PH-001')?.cls, 'badge-success', 'APPROVED -> badge-success');
      assertEqual(find('PH-002')?.cls, 'badge-danger', 'CANCELLED -> badge-danger');
      assertEqual(find('PH-003')?.cls, 'badge-info', 'PENDING -> badge-info (đổi từ vàng)');
    });

    await browser.close();
    server.close();
  }

  // ===== Văn Phòng Phẩm (gọi thẳng 2 hàm helper, không cần dựng cả bảng) =====
  {
    const server = await startStaticServer(PORT_UI + 2);
    const state = createMockState({ users: [ADMIN] });
    const { browser, page } = await launchPage(PORT_UI + 2, state);
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);

    await run.run('VPP: vppRegStatusBadge() — DRAFT dùng badge-neutral (Nháp, KHÁC nghĩa "cần bổ sung")', async () => {
      const result = await page.evaluate(() => ({
        draft: vppRegStatusBadge({ status: 'DRAFT' }),
        approved: vppRegStatusBadge({ status: 'APPROVED' }),
        rejected: vppRegStatusBadge({ status: 'REJECTED' }),
        cancelled: vppRegStatusBadge({ status: 'CANCELLED' }),
        pending: vppRegStatusBadge({ status: 'PENDING' })
      }));
      assertEqual(result.draft.includes('badge-neutral'), true, 'DRAFT phải dùng badge-neutral');
      assertEqual(result.approved.includes('badge-success'), true, 'APPROVED phải dùng badge-success');
      assertEqual(result.rejected.includes('badge-danger'), true, 'REJECTED phải dùng badge-danger');
      assertEqual(result.cancelled.includes('badge-danger'), true, 'CANCELLED phải dùng badge-danger');
      assertEqual(result.pending.includes('badge-info'), true, 'PENDING phải dùng badge-info');
    });

    await run.run('VPP: vppPeriodStatusBadge() — đang mở -> success, đã kết thúc -> neutral', async () => {
      const result = await page.evaluate(() => ({
        open: vppPeriodStatusBadge({ status: 'OPEN', endDate: '2099-01-01' }),
        closed: vppPeriodStatusBadge({ status: 'CLOSED', endDate: '2000-01-02' })
      }));
      assertEqual(result.open.includes('badge-success'), true, 'Đang mở phải dùng badge-success');
      assertEqual(result.closed.includes('badge-neutral'), true, 'Đã kết thúc phải dùng badge-neutral');
    });

    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
