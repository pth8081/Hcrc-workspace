// server/tests/test-meeting-edit-ui.js
//
// Phần CLIENT của tính năng "Sửa lịch họp + Gửi Phê Duyệt lại" (theo yêu cầu người dùng) — phần server
// (PUT /api/meetings/:id, quyền, check trùng loại trừ chính nó, APPROVED->PENDING) đã có
// tests/test-meeting-edit-route.js riêng, 10/10 kịch bản. File này kiểm UI thật:
//   - editMeeting(id): mở lại form Đăng Ký, đổ sẵn đúng dữ liệu cũ, hiện banner "Đang sửa".
//   - submitMeetingReq() ở chế độ Sửa: gọi ĐÚNG PUT /api/meetings/:id (không phải POST /api/create),
//     cập nhật lại DB.meetings, thoát chế độ Sửa sau khi lưu.
//   - cancelEditMeeting() ("✕ Hủy Sửa" trên banner): thoát chế độ Sửa, KHÔNG gọi API gì cả.
//   - renderMeetings(): nút "✏️ Sửa" (trong dropdown "Khác ▾") CHỈ hiện cho creator/meetingCancel/admin,
//     và KHÔNG hiện khi lịch đã CANCELLED.
//
// Chạy: node server/tests/test-meeting-edit-ui.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assert, assertEqual } = require('./testHarness');

const PORT = 8998;

const CREATOR = { username: 'nv_kd', name: 'Nhân Viên KD', dept: 'Phòng Kinh Doanh', role: 'STAFF',
  phone: '0900000001', email: 'nv_kd@company.com', jobTitle: 'Nhân viên', perms: { meetingBookScope: { all: true } }, active: true };
const OUTSIDER = { username: 'nv_khac', name: 'Nhân Viên Khác', dept: 'Phòng Kỹ Thuật', role: 'STAFF',
  phone: '0900000002', email: 'nv_khac@company.com', jobTitle: 'Nhân viên', perms: { meetingBookScope: { all: true } }, active: true };

const MEETING_PENDING = {
  id: 1, code: 'PH-001', dept: 'Phòng Kinh Doanh', room: 'Phòng Họp Lớn A', title: 'Họp KD tuần',
  startTime: '2026-10-20T08:00', endTime: '2026-10-20T09:00', status: 'PENDING',
  creator: 'nv_kd', creatorName: 'Nhân Viên KD', agenda: 'Đánh giá tuần', equipment: '', attendees: 5, customData: {}, createdAt: '2026-10-18 08:00:00'
};
const MEETING_CANCELLED = {
  id: 2, code: 'PH-002', dept: 'Phòng Kinh Doanh', room: 'Phòng Họp Lớn A', title: 'Đã huỷ',
  startTime: '2026-10-21T08:00', endTime: '2026-10-21T09:00', status: 'CANCELLED',
  creator: 'nv_kd', creatorName: 'Nhân Viên KD', agenda: '', equipment: '', attendees: 2, customData: {}, createdAt: '2026-10-18 08:00:00'
};

async function main() {
  const state = createMockState({
    depts: ['Phòng Kinh Doanh', 'Phòng Kỹ Thuật'],
    users: [CREATOR, OUTSIDER],
    meetings: [MEETING_PENDING, MEETING_CANCELLED],
    meetingRooms: [{ id: 1, name: 'Phòng Họp Lớn A', short: 'A' }, { id: 2, name: 'Phòng Họp Nhỏ B', short: 'B' }]
  });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)));
  const run = createRunner();

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, CREATOR);
    // Ghi đè fetch SAU proceedAfterAuth (login xong mới thay) — chỉ chặn riêng PUT /api/meetings/:id,
    // mọi request khác (GET /api/data...) vẫn đi qua dispatcher mock chuẩn của testHarness.
    await page.evaluate(() => {
      const orig = window.fetch;
      window.__putCalls = [];
      window.fetch = async (url, opts) => {
        if (typeof url === 'string' && /^\/api\/meetings\/\d+$/.test(url) && opts?.method === 'PUT') {
          const id = Number(url.split('/').pop());
          const payload = JSON.parse(opts.body);
          window.__putCalls.push({ id, payload });
          const item = DB.meetings.find((m) => m.id === id);
          const updated = Object.assign({}, item, payload);
          if (item.status === 'APPROVED') { updated.status = 'PENDING'; updated.approvedBy = null; updated.approvedByName = null; updated.approvedAt = null; }
          return { ok: true, status: 200, json: async () => ({ ok: true, item: updated }) };
        }
        return orig(url, opts);
      };
    });

    await page.evaluate(() => switchTab('meeting'));
    await page.waitForTimeout(200);

    await run.run('editMeeting(1): mở form Đăng Ký, đổ sẵn ĐÚNG dữ liệu cũ + hiện banner "Đang sửa"', async () => {
      await page.evaluate(() => editMeeting(1));
      await page.waitForTimeout(50);
      const state2 = await page.evaluate(() => ({
        editingId: editingMeetingId,
        dept: document.getElementById('meetingDept').value,
        room: document.getElementById('meetingRoom').value,
        title: document.getElementById('meetingTitle').value,
        attendees: document.getElementById('meetingAttendees').value,
        startTime: document.getElementById('meetingStartTime').value,
        bannerHidden: document.getElementById('meetingEditingBanner').classList.contains('hidden'),
        bannerCode: document.getElementById('meetingEditingCode').textContent,
        submitBtnText: document.getElementById('meetingSubmitBtn').textContent,
        activeSubTab: activeMeetingSubTab
      }));
      assertEqual(state2.editingId, 1);
      assertEqual(state2.dept, 'Phòng Kinh Doanh');
      assertEqual(state2.room, 'Phòng Họp Lớn A');
      assertEqual(state2.title, 'Họp KD tuần');
      assertEqual(state2.attendees, '5');
      assertEqual(state2.startTime, '2026-10-20T08:00');
      assertEqual(state2.bannerHidden, false, 'Banner "Đang sửa" phải hiện');
      assertEqual(state2.bannerCode, 'PH-001');
      assertEqual(state2.submitBtnText, '💾 Lưu Thay Đổi', 'PENDING sửa xong vẫn PENDING nên nhãn nút không nói "gửi lại"');
      assertEqual(state2.activeSubTab, 'REGISTER', 'Phải tự nhảy sang tab Đăng Ký');
    });

    await run.run('Lưu (submit form) ở chế độ Sửa: gọi ĐÚNG PUT /api/meetings/1 (không phải POST /api/create), cập nhật lại DB.meetings, thoát chế độ Sửa', async () => {
      await page.evaluate(() => { document.getElementById('meetingTitle').value = 'Họp KD tuần (đã sửa qua UI)'; });
      await page.evaluate(() => document.getElementById('meetingForm').requestSubmit());
      await page.waitForTimeout(100);
      const result = await page.evaluate(() => ({
        putCalls: window.__putCalls,
        meetingTitle: DB.meetings.find((m) => m.id === 1).title,
        editingId: editingMeetingId,
        bannerHidden: document.getElementById('meetingEditingBanner').classList.contains('hidden')
      }));
      assertEqual(result.putCalls.length, 1, 'Phải gọi callMeetingUpdate() đúng 1 lần (PUT), KHÔNG phải callCreateAction()');
      assertEqual(result.putCalls[0].id, 1);
      assertEqual(result.putCalls[0].payload.title, 'Họp KD tuần (đã sửa qua UI)');
      assertEqual(result.meetingTitle, 'Họp KD tuần (đã sửa qua UI)', 'DB.meetings phải cập nhật lại đúng bản mới');
      assertEqual(result.editingId, null, 'Phải thoát chế độ Sửa sau khi lưu xong');
      assertEqual(result.bannerHidden, true, 'Banner phải ẩn lại sau khi lưu xong');
    });

    await run.run('cancelEditMeeting() ("✕ Hủy Sửa"): thoát chế độ Sửa, KHÔNG gọi PUT nào cả', async () => {
      await page.evaluate(() => { window.__putCalls = []; editMeeting(1); });
      await page.waitForTimeout(50);
      await page.evaluate(() => cancelEditMeeting());
      await page.waitForTimeout(50);
      const result = await page.evaluate(() => ({ editingId: editingMeetingId, putCalls: window.__putCalls.length, bannerHidden: document.getElementById('meetingEditingBanner').classList.contains('hidden') }));
      assertEqual(result.editingId, null);
      assertEqual(result.putCalls, 0, 'Hủy Sửa không được gọi API nào');
      assertEqual(result.bannerHidden, true);
    });

    await run.run('renderMeetings(): creator thấy nút "✏️ Sửa" trong dropdown "Khác ▾" của lịch PENDING của chính mình', async () => {
      const html = await page.evaluate(() => { renderMeetings(); return document.getElementById('meetingTableBody').innerHTML; });
      assert(html.includes('Sửa'), 'Phải có tuỳ chọn Sửa trong dropdown thao tác');
      assert(html.includes('data-arg1="edit"') || html.includes("value=\"edit\""), 'data-op phải trỏ đúng action edit');
    });

    await run.run('renderMeetings(): lịch ĐÃ HUỶ KHÔNG có nút "✏️ Sửa" (dù là creator)', async () => {
      const cellHtml = await page.evaluate(() => {
        renderMeetings();
        const rows = Array.from(document.querySelectorAll('#meetingTableBody tr'));
        const row = rows.find((r) => r.textContent.includes('PH-002'));
        return row ? row.innerHTML : '';
      });
      assert(!cellHtml.includes('value="edit"'), 'Lịch đã Huỷ không được có tuỳ chọn Sửa');
    });

    await run.run('canEditMeeting(): người NGOÀI (không phải creator, không meetingCancel/admin) -> false', async () => {
      const canEdit = await page.evaluate((m) => {
        const outsider = { username: 'nv_khac', perms: {} };
        return canEditMeeting(outsider, m);
      }, MEETING_PENDING);
      assertEqual(canEdit, false);
    });

    await run.run('canEditMeeting(): creator -> true; người có meetingCancel -> true', async () => {
      const results2 = await page.evaluate((m) => ({
        creator: canEditMeeting({ username: 'nv_kd', perms: {} }, m),
        manager: canEditMeeting({ username: 'someone_else', perms: { meetingCancel: true } }, m)
      }), MEETING_PENDING);
      assertEqual(results2.creator, true);
      assertEqual(results2.manager, true);
    });

    assertEqual(pageErrors.length, 0, `Không có lỗi JS chưa bắt: ${JSON.stringify(pageErrors)}`);

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', err && err.stack || err);
  process.exitCode = 1;
});
