// server/tests/test-task-status-badges.js
//
// Regression test cho Giai đoạn 2c "HCRC Workspace Refresh" (11/2026) — badge trạng thái Công Việc
// (renderTasks(), module-congviec.js) đổi từ class Tailwind tự chọn màu riêng (vd "bg-blue-100
// text-blue-800") sang .badge-info/.badge-success/.badge-danger/.badge-neutral DÙNG CHUNG (app.css),
// khớp đúng 4 màu trạng thái đã chuẩn hoá cho toàn hệ thống.
//
// LƯU Ý QUAN TRỌNG (phát hiện trong lúc triển khai): enum trạng thái CÔNG VIỆC thật chỉ có đúng 4 giá
// trị TODO/DOING/DONE/CANCELLED (xem TASK_STATUS_TRANSITIONS/TASK_STATUS_LABELS, lib/recordActions.js)
// — "OVERDUE" KHÔNG BAO GIỜ là giá trị thật của t.status (chỉ là 1 nhóm lọc PHÁI SINH tính từ hạn chót,
// xem isOverdue()), nên premise ban đầu "Công Việc hiện badge dạng chữ thô IN_PROGRESS/OVERDUE" (từ
// ảnh demo) không tái hiện được trên dữ liệu enum thật — mã nguồn trước đó đã render đủ badge màu cho
// cả 4 trạng thái thật, chỉ là dùng class Tailwind rời rạc thay vì hệ thống dùng chung. Test này xác
// nhận ĐÚNG phạm vi đã làm: migrate class, giữ nguyên nhãn/icon/hành vi.
//
// Chạy: node server/tests/test-task-status-badges.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual, assertIncludes } = require('./testHarness');

const PORT_UI = 8989;

async function main() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({
    users: [ADMIN],
    tasks: [
      { id: 1, title: 'Việc chưa bắt đầu', status: 'TODO', assignedBy: 'admin', assignedByName: 'Quản Trị Viên Test', sourceType: 'MANUAL', createdAt: '2026-11-01T00:00:00Z' },
      { id: 2, title: 'Việc đang làm', status: 'DOING', assignedTo: 'admin', assignedToName: 'Quản Trị Viên Test', assignedBy: 'admin', assignedByName: 'Quản Trị Viên Test', sourceType: 'MANUAL', createdAt: '2026-11-01T00:00:00Z' },
      { id: 3, title: 'Việc xong rồi', status: 'DONE', assignedTo: 'admin', assignedToName: 'Quản Trị Viên Test', assignedBy: 'admin', assignedByName: 'Quản Trị Viên Test', sourceType: 'MANUAL', createdAt: '2026-11-01T00:00:00Z' },
      { id: 4, title: 'Việc đã huỷ', status: 'CANCELLED', assignedBy: 'admin', assignedByName: 'Quản Trị Viên Test', sourceType: 'MANUAL', createdAt: '2026-11-01T00:00:00Z' }
    ]
  });
  const { browser, page } = await launchPage(PORT_UI, state);
  const run = createRunner();

  try {
    await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
    await page.evaluate(() => { switchTab('task'); });
    await page.waitForTimeout(150);

    await run.run('4 trạng thái thật (TODO/DOING/DONE/CANCELLED) đều render đúng class .badge-* dùng chung', async () => {
      const rows = await page.evaluate(() => {
        const trs = Array.from(document.querySelectorAll('#taskTableBody tr'));
        return trs.map(tr => {
          const badge = tr.querySelector('.badge-info, .badge-success, .badge-danger, .badge-neutral');
          // textContent (không phải innerText) — .badge-* có text-transform:uppercase (CSS thuần, không
          // đổi nội dung DOM thật), innerText phản ánh chữ ĐÃ BIẾN ĐỔI theo CSS nên luôn ra chữ hoa.
          return { title: tr.querySelector('td')?.innerText || '', cls: badge?.className || null, text: badge?.textContent || null };
        });
      });
      const byTitle = Object.fromEntries(rows.map(r => [r.title.split('\n')[0], r]));
      assertEqual(byTitle['Việc chưa bắt đầu']?.cls, 'badge-neutral', 'TODO phải dùng .badge-neutral');
      assertIncludes(byTitle['Việc chưa bắt đầu']?.text, 'Chưa bắt đầu', 'TODO phải giữ đúng nhãn tiếng Việt');
      assertEqual(byTitle['Việc đang làm']?.cls, 'badge-info', 'DOING phải dùng .badge-info');
      assertEqual(byTitle['Việc xong rồi']?.cls, 'badge-success', 'DONE phải dùng .badge-success');
      assertEqual(byTitle['Việc đã huỷ']?.cls, 'badge-danger', 'CANCELLED phải dùng .badge-danger');
    });

    await run.run('Badge .badge-info (DOING) đúng màu nền #dbeafe (khớp hệ thống thiết kế dùng chung)', async () => {
      const bg = await page.evaluate(() => {
        const tr = Array.from(document.querySelectorAll('#taskTableBody tr')).find(r => r.innerText.includes('Việc đang làm'));
        return getComputedStyle(tr.querySelector('.badge-info')).backgroundColor;
      });
      assertEqual(bg, 'rgb(219, 234, 254)', 'Phải khớp đúng --hcrc-info-bg #dbeafe');
    });

    await run.run('KHÔNG còn sót class Tailwind rời rạc cũ (bg-blue-100/bg-green-100/bg-red-100/bg-gray-100) trên badge trạng thái', async () => {
      const stale = await page.evaluate(() => {
        const trs = Array.from(document.querySelectorAll('#taskTableBody tr'));
        return trs.some(tr => /bg-(blue|green|red|gray)-100/.test(tr.innerHTML));
      });
      assertEqual(stale, false, 'Không được còn sót class Tailwind cũ nào trong cột Trạng thái');
    });
  } finally {
    await browser.close();
    server.close();
  }

  run.summary();
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
