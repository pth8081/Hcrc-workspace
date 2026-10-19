// server/tests/test-editdraft-admin-mirror.js
//
// LỖI ĐÃ VÁ (re-audit lần 8, mức TB — "Mirror lệch: nút Sửa & Gửi Lại không hiện cho Admin ở Tài
// Liệu/Văn Bản Trình"): editDocDraft()/editSubmissionDraft() (lib/recordActions.js, đợt vá rà soát
// vòng 2) đã cho phép ADMIN sửa hồ sơ NHÁP (status DRAFT, do bị trả về REQUEST_CHANGES) của NGƯỜI
// KHÁC — phòng trường hợp người tải lên/người trình đã nghỉ việc, không còn ai sửa được. Nhưng điều
// kiện hiện nút "✏️ Sửa & Gửi Lại" ở module-tailieu.js/module-vanbantrinh.js chỉ xét
// uploader/creator === currentUser.username, KHÔNG có nhánh admin — admin muốn sửa phải tự gọi API
// trực tiếp (DevTools/Postman), lệch hẳn với quyền server đã cho phép. module-internalcomms-nhipsong.js
// (NEED_INFO/DRAFT của Nhịp Sống) đã làm đúng mẫu `(p.author === currentUser.username ||
// currentUser.perms?.admin)` từ đầu — dùng đúng mẫu đó cho cả 2 module.
//
// Test: render UI THẬT (Playwright qua testHarness), DRAFT do NGƯỜI KHÁC tạo (không phải admin đang
// đăng nhập) — xác nhận option "editDraft" trong <select> "Khác ▾" của dòng đó CÓ xuất hiện khi admin,
// và vẫn CHỈ xuất hiện cho đúng người tạo khi KHÔNG phải admin (đối chứng, không nới lỏng quá tay).
//
// Chạy: node server/tests/test-editdraft-admin-mirror.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual } = require('./testHarness');

const PORT_UI = 8983;

async function hasEditDraftOption(page, tbodySelector, rowNeedle) {
  return page.evaluate(({ tbodySelector, rowNeedle }) => {
    const trs = Array.from(document.querySelectorAll(tbodySelector + ' tr'));
    const tr = trs.find(t => t.innerText.includes(rowNeedle));
    if (!tr) return null;
    const select = tr.querySelector('select');
    if (!select) return false;
    return Array.from(select.options).some(o => o.value === 'editDraft');
  }, { tbodySelector, rowNeedle });
}

async function main() {
  const ADMIN = { username: 'admin', name: 'Quản Trị Viên Test', dept: 'Phòng CNTT', perms: { admin: true }, totpEnabled: true, active: true };
  const STAFF = { username: 'nv_khac', name: 'Nhân Viên Khác', dept: 'Phòng CNTT', perms: {}, totpEnabled: true, active: true };

  const server = await startStaticServer(PORT_UI);
  const state = createMockState({
    users: [ADMIN, STAFF],
    workflows: [{ id: 'WF_1STEP', name: 'Quy trình 1 bước', steps: [{ name: 'Sếp duyệt' }] }],
    docs: [
      { id: 1, code: 'DOC-DRAFT-01', title: 'Tài liệu cần bổ sung (người khác tải lên)', summary: '', status: 'DRAFT', dept: 'Phòng CNTT', uploader: 'nv_khac', uploaderName: 'Nhân Viên Khác', cat: 'Chung', ver: '1', currentStep: 0, history: [] },
      { id: 2, code: 'DOC-DRAFT-02', title: 'Tài liệu cần bổ sung (chính người tải lên)', summary: '', status: 'DRAFT', dept: 'Phòng CNTT', uploader: 'admin', uploaderName: ADMIN.name, cat: 'Chung', ver: '1', currentStep: 0, history: [] }
    ],
    submissions: [
      { id: 101, code: 'VB-DRAFT-01', title: 'Tờ trình cần bổ sung (người khác trình)', status: 'DRAFT', dept: 'Phòng CNTT', creator: 'nv_khac', creatorName: 'Nhân Viên Khác', currentStep: 0, history: [] },
      { id: 102, code: 'VB-DRAFT-02', title: 'Tờ trình cần bổ sung (chính người trình)', status: 'DRAFT', dept: 'Phòng CNTT', creator: 'admin', creatorName: ADMIN.name, currentStep: 0, history: [] }
    ]
  });
  const { browser, page } = await launchPage(PORT_UI, state);
  const run = createRunner();

  try {
    await run.run('Tài Liệu — ADMIN (không phải uploader) VẪN thấy nút "Sửa & Gửi Lại" trên hồ sơ NHÁP của người khác', async () => {
      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
      await page.evaluate(() => { switchTab('doc'); });
      await page.waitForTimeout(150);
      const has = await hasEditDraftOption(page, '#docTableBody', 'DOC-DRAFT-01');
      assertEqual(has, true, 'Admin phải thấy option editDraft trên NHÁP của người khác (khớp quyền server editDocDraft() đã cho phép)');
    });

    await run.run('Tài Liệu — ADMIN vẫn thấy nút trên CHÍNH hồ sơ của mình (đối chứng, không mất hành vi cũ)', async () => {
      const has = await hasEditDraftOption(page, '#docTableBody', 'DOC-DRAFT-02');
      assertEqual(has, true);
    });

    await run.run('Tài Liệu — NHÂN VIÊN THƯỜNG (không phải uploader, không admin) KHÔNG thấy nút trên NHÁP của người khác', async () => {
      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, STAFF);
      await page.evaluate(() => { switchTab('doc'); });
      await page.waitForTimeout(150);
      const has = await hasEditDraftOption(page, '#docTableBody', 'DOC-DRAFT-02');
      assertEqual(has, false, 'Nhân viên thường không phải uploader/admin KHÔNG được thấy nút (không nới lỏng quá tay)');
    });

    await run.run('Tài Liệu — NHÂN VIÊN THƯỜNG vẫn thấy nút trên CHÍNH hồ sơ mình tải lên (đối chứng)', async () => {
      const has = await hasEditDraftOption(page, '#docTableBody', 'DOC-DRAFT-01');
      assertEqual(has, true);
    });

    await run.run('Văn Bản Trình — ADMIN (không phải creator) VẪN thấy nút "Sửa & Gửi Lại" trên hồ sơ NHÁP của người khác', async () => {
      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, ADMIN);
      await page.evaluate(() => { switchTab('submission'); });
      await page.waitForTimeout(150);
      const has = await hasEditDraftOption(page, '#submissionTableBody', 'VB-DRAFT-01');
      assertEqual(has, true, 'Admin phải thấy option editDraft trên NHÁP của người khác (khớp quyền server editSubmissionDraft() đã cho phép)');
    });

    await run.run('Văn Bản Trình — NHÂN VIÊN THƯỜNG (không phải creator, không admin) KHÔNG thấy nút trên NHÁP của người khác', async () => {
      await page.evaluate(async (u) => { await proceedAfterAuth(u); }, STAFF);
      await page.evaluate(() => { switchTab('submission'); });
      await page.waitForTimeout(150);
      const has = await hasEditDraftOption(page, '#submissionTableBody', 'VB-DRAFT-02');
      assertEqual(has, false, 'Nhân viên thường không phải creator/admin KHÔNG được thấy nút');
    });

    await run.run('Văn Bản Trình — NHÂN VIÊN THƯỜNG vẫn thấy nút trên CHÍNH hồ sơ mình trình (đối chứng)', async () => {
      const has = await hasEditDraftOption(page, '#submissionTableBody', 'VB-DRAFT-01');
      assertEqual(has, true);
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
