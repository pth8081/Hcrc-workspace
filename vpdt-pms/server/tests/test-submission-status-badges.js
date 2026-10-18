// server/tests/test-submission-status-badges.js
//
// Regression test cho Giai đoạn 3a "HCRC Workspace Refresh" (11/2026) — badge trạng thái Văn Bản Trình
// (renderSubmissions(), module-vanbantrinh.js) đổi sang .badge-* DÙNG CHUNG, cùng đợt + cùng khuôn với
// Tài liệu (test-doc-status-badges.js). Gồm thêm 1 nhánh riêng "pendingFileProposal" (purple cũ) gộp về
// bucket info.
//
// Chạy: node server/tests/test-submission-status-badges.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual } = require('./testHarness');

const PORT_UI = 8984;

async function main() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({
    users: [ADMIN],
    workflows: [{ id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ name: 'Sếp duyệt' }] }],
    submissions: [
      { id: 1, code: 'VB-001', title: 'Đã phê duyệt', status: 'APPROVED', dept: 'Phòng CNTT', creator: 'admin', currentStep: 1 },
      { id: 2, code: 'VB-002', title: 'Bị từ chối', status: 'REJECTED', dept: 'Phòng CNTT', creator: 'admin', currentStep: 1 },
      { id: 3, code: 'VB-003', title: 'Cần bổ sung', status: 'DRAFT', dept: 'Phòng CNTT', creator: 'admin', currentStep: 0 },
      { id: 4, code: 'VB-004', title: 'Đang chờ duyệt', status: 'PENDING', dept: 'Phòng CNTT', creator: 'admin', currentStep: 1 },
      { id: 5, code: 'VB-005', title: 'Chờ xác nhận thay thế', status: 'PENDING', dept: 'Phòng CNTT', creator: 'admin', currentStep: 1, pendingFileProposal: { fileUrl: '/uploads/x.pdf', fileName: 'x.pdf' } }
    ]
  });
  const { browser, page } = await launchPage(PORT_UI, state);
  const run = createRunner();

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('submission'); });
    await page.waitForTimeout(150);

    await run.run('5 trạng thái Văn Bản Trình đều render đúng class .badge-* dùng chung', async () => {
      const rows = await page.evaluate(() => {
        const trs = Array.from(document.querySelectorAll('#submissionTableBody tr'));
        return trs.map(tr => {
          const badge = tr.querySelector('.badge-info, .badge-success, .badge-danger, .badge-warning');
          return { text: tr.innerText, cls: badge?.className || null };
        });
      });
      const find = (needle) => rows.find(r => r.text.includes(needle));
      assertEqual(find('VB-001')?.cls, 'badge-success', 'APPROVED phải dùng .badge-success');
      assertEqual(find('VB-002')?.cls, 'badge-danger', 'REJECTED phải dùng .badge-danger');
      assertEqual(find('VB-003')?.cls, 'badge-warning', 'DRAFT (cần bổ sung) phải dùng .badge-warning');
      assertEqual(find('VB-004')?.cls, 'badge-info', 'Đang chờ duyệt phải dùng .badge-info');
      assertEqual(find('VB-005')?.cls, 'badge-info', 'Chờ xác nhận thay thế (pendingFileProposal, cũ màu tím) phải gộp về .badge-info');
    });

    await run.run('KHÔNG còn sót class Tailwind rời rạc cũ (bg-green-100/bg-red-100/bg-orange-100/bg-amber-100/bg-purple-100) trên badge trạng thái', async () => {
      const stale = await page.evaluate(() => {
        const trs = Array.from(document.querySelectorAll('#submissionTableBody tr'));
        return trs.some(tr => /bg-(green|red|orange|amber|purple)-100/.test(tr.innerHTML));
      });
      assertEqual(stale, false, 'Không được còn sót class Tailwind cũ nào trong cột trạng thái Văn Bản Trình');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
