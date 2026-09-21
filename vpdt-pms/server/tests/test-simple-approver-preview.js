// server/tests/test-simple-approver-preview.js
//
// "Xem Quy Trình" cho 4 module CHỈ CÓ 1 BƯỚC duyệt qua cờ quyền phẳng (không có dept-workflow nhiều
// bước như 10+ module khác — xem openGenericWorkflowPreviewModal()): Đặt Phòng Họp, Đồng Phục, Công&Phép
// (nghỉ phép + đổi ca) — rà soát chuyên sâu phát hiện các module này thiếu hẳn nút "Xem Quy Trình" dù
// toolbar bên cạnh (VD Đăng Ký Xe) đã có từ lâu. Vá bằng openSimpleApproverPreviewModal()/
// getFlatApproverUsernames() (core.js) + 4 hàm wrapper previewMeetingWorkflow()/
// previewUniformApprovalWorkflow()/previewHacLeaveWorkflow()/previewHacSwapWorkflow().
//
// Chạy: node server/tests/test-simple-approver-preview.js
'use strict';
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8993;

async function main() {
  const { server, browser, page } = await setup(PORT);
  const run = makeRunner();

  try {
    const admin = makeUser({ username: 'admin', name: 'Quản Trị Viên', perms: { admin: true } });
    const meetingApprover = makeUser({ username: 'qlph1', name: 'Phạm Quản Lý Phòng Họp', perms: { meetingApprove: true } });
    const uniformApprover = makeUser({ username: 'hc1', name: 'Hành Chính Một', perms: { uniformManage: true } });
    const hacManager = makeUser({ username: 'hr1', name: 'Nhân Sự Một', perms: { hrAttendanceManage: true } });

    await page.evaluate((seed) => {
      Object.assign(DB, {
        ...seed,
        users: [seed.__admin, seed.__meetingApprover, seed.__uniformApprover, seed.__hacManager],
        moduleApproverUsernames: {
          meetingApprove: [seed.__admin.username, seed.__meetingApprover.username],
          uniformApprove: [], uniformManage: [seed.__admin.username, seed.__uniformApprover.username],
          hrLeaveApprove: [], hrAttendanceManage: [seed.__admin.username, seed.__hacManager.username],
          hrShiftSwapApprove: []
        }
      });
    }, { ...baseCatalogSeed(), __admin: admin, __meetingApprover: meetingApprover, __uniformApprover: uniformApprover, __hacManager: hacManager });

    await page.evaluate((u) => { finishLogin(u); }, admin);

    const readModal = () => page.evaluate(() => ({
      visible: !document.getElementById('viewDocModal').classList.contains('hidden'),
      title: document.getElementById('viewModalTitle').innerText,
      content: document.getElementById('viewModalContent').innerText
    }));
    const closeModal = () => page.evaluate(() => document.getElementById('viewDocModal').classList.add('hidden'));

    await run.run('previewMeetingWorkflow(): hiện đúng người duyệt (meetingApprove — admin + qlph1)', async () => {
      await page.evaluate(() => previewMeetingWorkflow());
      const m = await readModal();
      assert(m.visible, 'modal phải hiện ra');
      assert(m.title.includes('Đặt Phòng Họp'), `title sai: ${m.title}`);
      assert(m.content.includes('Quản Trị Viên') && m.content.includes('Phạm Quản Lý Phòng Họp'), `content thiếu tên người duyệt: ${m.content}`);
      await closeModal();
    });

    await run.run('previewUniformApprovalWorkflow(): gộp ĐÚNG cả 2 cờ uniformApprove+uniformManage (không trùng lặp admin)', async () => {
      await page.evaluate(() => previewUniformApprovalWorkflow());
      const m = await readModal();
      assert(m.visible, 'modal phải hiện ra');
      assert(m.content.includes('Hành Chính Một'), `content thiếu người duyệt uniformManage: ${m.content}`);
      const adminCount = (m.content.match(/Quản Trị Viên/g) || []).length;
      assertEqual(adminCount, 1, 'admin trùng trong cả 2 cờ phải chỉ hiện 1 lần (Set dedupe)');
      await closeModal();
    });

    await run.run('previewHacLeaveWorkflow(): hiện đúng người duyệt nghỉ phép (hrAttendanceManage)', async () => {
      await page.evaluate(() => previewHacLeaveWorkflow());
      const m = await readModal();
      assert(m.visible, 'modal phải hiện ra');
      assert(m.title.includes('Nghỉ Phép'), `title sai: ${m.title}`);
      assert(m.content.includes('Nhân Sự Một'), `content thiếu người duyệt: ${m.content}`);
      await closeModal();
    });

    await run.run('previewHacSwapWorkflow(): hiện đúng người duyệt đổi ca (hrAttendanceManage, hrShiftSwapApprove rỗng)', async () => {
      await page.evaluate(() => previewHacSwapWorkflow());
      const m = await readModal();
      assert(m.visible, 'modal phải hiện ra');
      assert(m.title.includes('Đổi Ca'), `title sai: ${m.title}`);
      assert(m.content.includes('Nhân Sự Một'), `content thiếu người duyệt: ${m.content}`);
      await closeModal();
    });

    await run.run('Chưa cấu hình ai duyệt (cờ rỗng): hiện đúng cảnh báo, KHÔNG hiện danh sách rỗng câm lặng', async () => {
      await page.evaluate(() => { DB.moduleApproverUsernames.meetingApprove = []; });
      await page.evaluate(() => previewMeetingWorkflow());
      const m = await readModal();
      assert(m.content.includes('Chưa có ai được cấp quyền duyệt'), `phải hiện cảnh báo rõ ràng khi chưa cấu hình: ${m.content}`);
      await closeModal();
    });

    run.summarize('test-simple-approver-preview');
  } finally {
    await teardown({ server, browser });
  }
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
