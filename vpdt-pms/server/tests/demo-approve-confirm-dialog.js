// server/tests/demo-approve-confirm-dialog.js
//
// DEMO thật (không phải bộ hồi quy tự động) — chụp ảnh tính năng MỚI "hộp thoại xác nhận Đồng Ý/Hủy khi
// bấm Duyệt" (v29.28), theo yêu cầu người dùng "gửi ảnh demo nhé" sau khi merge. Minh hoạ 2 trong 3
// module trước đây HOÀN TOÀN chưa có xác nhận gì (bấm Duyệt là duyệt ngay):
//   1. Tài Liệu (module-tailieu.js, approveDoc()) — chụp cả before/modal-mở/after (round-trip thật qua
//      applyWorkflowAction() thật, không phải ảnh tĩnh).
//   2. Phòng Họp (module-phonghop.js, approveMeeting()) — chụp before/modal-mở (route /api/meetings/*
//      không có trong testHarness.js dùng chung, nên chỉ demo tới bước mở hộp thoại — bản thân việc MỞ
//      hộp thoại là hành vi client thuần, không cần gọi server).
//
// Dùng testHarness.js (Chromium thật mở public/index.html thật qua static server, applyWorkflowAction()
// THẬT cho 'docs' — khớp đúng khuôn demo-approval-hub-submitter.js).
//
// Chạy: node server/tests/demo-approve-confirm-dialog.js
'use strict';

const fs = require('fs');
const path = require('path');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8997;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'approve-confirm-dialog');

const APPROVER = {
  username: 'demo_admin', name: 'Quản Trị Viên Demo', dept: 'Phòng Hành Chính',
  perms: { admin: true, meetingApprove: true }, active: true, totpEnabled: true,
};
const CREATOR = {
  username: 'nva', name: 'Nguyễn Văn A', dept: 'Phòng Hành Chính',
  perms: {}, active: true, totpEnabled: true,
};

async function shot(page, selector, file, label) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log(`📸 ${label} ->`, file);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const state = createMockState({
    depts: ['Phòng Hành Chính'], stores: [],
    users: [APPROVER, CREATOR],
    deptWorkflows: { 'Phòng Hành Chính': { approvers: { 1: ['demo_admin'] }, steps: [{ name: 'Trưởng phòng duyệt' }] } },
    docs: [
      { id: 301, dept: 'Phòng Hành Chính', status: 'PENDING', currentStep: 1, history: [],
        displayCode: 'TL-0150', code: 'TL-0150', title: 'Quy định sử dụng xe công ty 2027',
        summary: 'Cập nhật quy định sử dụng xe công ty áp dụng từ 01/01/2027.', cat: 'Quy Định', ver: '1',
        uploader: 'nva', uploaderName: 'Nguyễn Văn A', createdAt: '08:00:00 05/11/2026', published: false },
    ],
    meetings: [
      { id: 501, code: 'HCRC-PH-001', dept: 'Phòng Hành Chính', room: 'Phòng Họp Lớn A (Tầng 3)',
        status: 'PENDING', creator: 'nva', creatorName: 'Nguyễn Văn A',
        startTime: '2026-11-10T09:00', endTime: '2026-11-10T10:00', attendees: 8,
        equipment: '', agenda: 'Họp review tiến độ tháng 11', createdAt: '08:00:00 05/11/2026', history: [] },
    ],
  });

  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);
  await page.setViewportSize({ width: 1180, height: 820 });

  try {
    await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, APPROVER);
    await page.waitForTimeout(150);

    // ===== 1) Tài Liệu — before / modal mở / after (round-trip thật) =====
    await page.evaluate(async () => { await switchTab('doc'); });
    await page.waitForTimeout(150);
    const docListSel = 'table:has(#docTableBody)';
    await shot(page, docListSel, '01-tailieu-truoc-khi-bam-duyet.png', 'Tài Liệu — trước khi bấm Duyệt');

    await page.click('[data-op="runDocAction"][data-arg0="301"][data-arg1="approve"]');
    await page.waitForTimeout(150);
    await shot(page, '#genericConfirmModal > div', '02-tailieu-hop-thoai-xac-nhan.png', 'Tài Liệu — hộp thoại xác nhận mở ra');

    await page.click('#genericConfirmOkBtn');
    await page.waitForTimeout(250);
    await shot(page, docListSel, '03-tailieu-sau-khi-dong-y.png', 'Tài Liệu — sau khi bấm Đồng Ý (đã duyệt xong)');

    // ===== 2) Phòng Họp — before / modal mở (route server chưa mock trong harness chung, chỉ demo UI) =====
    await page.evaluate(async () => { await switchTab('meeting'); });
    await page.waitForTimeout(150);
    await shot(page, '#meetingSection table', '04-phonghop-truoc-khi-bam-duyet.png', 'Phòng Họp — trước khi bấm Duyệt');

    await page.click('[data-op="approveMeeting"][data-arg0="501"]');
    await page.waitForTimeout(150);
    await shot(page, '#genericConfirmModal > div', '05-phonghop-hop-thoai-xac-nhan.png', 'Phòng Họp — hộp thoại xác nhận mở ra');

    console.log('\n✅ Demo xong — ảnh lưu tại', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})();
