// server/tests/test-doc-status-badges.js
//
// Regression test cho Giai đoạn 3a "HCRC Workspace Refresh" (11/2026) — badge trạng thái Tài liệu
// (renderDocs(), module-tailieu.js) đổi từ class Tailwind rời rạc sang .badge-* DÙNG CHUNG (app.css),
// khớp đúng 4 màu đã chuẩn hoá ở mẫu email (v26.21): APPROVED→success, REJECTED→danger, DRAFT(cần bổ
// sung)→warning, đang chờ duyệt ở 1 bước→info (ĐỔI từ vàng sang xanh dương, khớp đúng ⏳ "Cần phê duyệt"
// đã dùng ở email — "đang chờ xử lý" là info, không phải warning).
//
// Chạy: node server/tests/test-doc-status-badges.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual } = require('./testHarness');

const PORT_UI = 8985;

async function main() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({
    users: [ADMIN],
    workflows: [{ id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ name: 'Sếp duyệt' }] }],
    docs: [
      { id: 1, code: 'DOC-001', title: 'Tài liệu đã duyệt', status: 'APPROVED', dept: 'Phòng CNTT', creator: 'admin', currentStep: 1 },
      { id: 2, code: 'DOC-002', title: 'Tài liệu bị từ chối', status: 'REJECTED', dept: 'Phòng CNTT', creator: 'admin', currentStep: 1 },
      { id: 3, code: 'DOC-003', title: 'Tài liệu cần bổ sung', status: 'DRAFT', dept: 'Phòng CNTT', creator: 'admin', currentStep: 0 },
      { id: 4, code: 'DOC-004', title: 'Tài liệu đang chờ duyệt', status: 'PENDING', dept: 'Phòng CNTT', creator: 'admin', currentStep: 1 }
    ]
  });
  const { browser, page } = await launchPage(PORT_UI, state);
  const run = createRunner();

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('doc'); });
    await page.waitForTimeout(150);

    await run.run('4 trạng thái Tài liệu đều render đúng class .badge-* dùng chung', async () => {
      const rows = await page.evaluate(() => {
        const trs = Array.from(document.querySelectorAll('#docTableBody tr'));
        return trs.map(tr => {
          const badge = tr.querySelector('.badge-info, .badge-success, .badge-danger, .badge-warning');
          return { text: tr.innerText, cls: badge?.className || null };
        });
      });
      const find = (needle) => rows.find(r => r.text.includes(needle));
      assertEqual(find('DOC-001')?.cls, 'badge-success', 'APPROVED phải dùng .badge-success');
      assertEqual(find('DOC-002')?.cls, 'badge-danger', 'REJECTED phải dùng .badge-danger');
      assertEqual(find('DOC-003')?.cls, 'badge-warning', 'DRAFT (cần bổ sung) phải dùng .badge-warning');
      assertEqual(find('DOC-004')?.cls, 'badge-info', 'Đang chờ duyệt ở 1 bước phải dùng .badge-info (ĐỔI từ vàng sang xanh dương)');
    });

    await run.run('KHÔNG còn sót class Tailwind rời rạc cũ (bg-green-100/bg-red-100/bg-orange-100/bg-yellow-100) trên badge trạng thái Tài liệu', async () => {
      const stale = await page.evaluate(() => {
        const trs = Array.from(document.querySelectorAll('#docTableBody tr'));
        return trs.some(tr => /bg-(green|red|orange|yellow)-100/.test(tr.innerHTML));
      });
      assertEqual(stale, false, 'Không được còn sót class Tailwind cũ nào trong cột trạng thái Tài liệu');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
