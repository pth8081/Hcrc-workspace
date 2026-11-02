// tests/test-internalpost-edit-approved-client.js — phần CLIENT của đợt vá "nút Sửa không hiện cho bài
// Nhịp Sống HCRC/Góc Chia Sẻ đã ĐĂNG CÔNG KHAI" (xem tests/test-internalpost-edit-approved.js cho phần
// server lib/recordActions.js editInternalPost()).
//
// Kiểm 3 việc phía client (module-internalcomms-nhipsong.js):
//   1. canEditInternalPostUI()/internalPostEditButtonHTML() nay trả về nút Sửa cho bài APPROVED.
//   2. editInternalPostUI() mở form Sửa cho bài APPROVED, nút Gửi đổi nhãn "Lưu Thay Đổi".
//   3. Nút "📝 Lưu Nháp" bị ẩn khi Sửa bài APPROVED (không có khái niệm nháp hoá bài đã đăng công khai),
//      nhưng hiện lại bình thường khi huỷ Sửa / Sửa bài DRAFT khác.
//
// Chạy: node tests/test-internalpost-edit-approved-client.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8995;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();
  try {
    const admin = makeUser({ username: 'admin1', name: 'Quản Trị Viên', dept: 'Phòng CNTT', perms: { admin: true } });
    const approvedPost = { id: 991001, type: 'NEWS', author: 'nv_khac', status: 'APPROVED', title: 'Tin đã đăng', content: 'Nội dung', postCategory: 'CAT1', images: [], coverImage: null, videos: [], customData: {} };
    const draftPost = { id: 991002, type: 'NEWS', author: 'nv_khac', status: 'DRAFT', title: 'Bản nháp', content: 'Nội dung', postCategory: 'CAT1', images: [], coverImage: null, videos: [], customData: {} };
    await page.evaluate((seed) => {
      Object.assign(DB, seed);
      DB.internalNewsCategories = [{ key: 'CAT1', label: 'Chuyên đề 1' }];
    }, baseCatalogSeed());
    await page.evaluate((u) => { DB.users = [u]; }, admin);
    await page.evaluate((posts) => { DB.internalPosts = posts; }, [approvedPost, draftPost]);
    await page.evaluate((u) => finishLogin(u), admin);
    await page.evaluate(() => { if (typeof stopApprovalPolling === 'function') stopApprovalPolling(); });
    await page.evaluate(() => switchTab('internal'));

    await run('canEditInternalPostUI() trả true cho bài APPROVED (admin)', async () => {
      const canEdit = await page.evaluate((p) => canEditInternalPostUI(p), approvedPost);
      assertEqual(canEdit, true, 'canEditInternalPostUI');
    });

    await run('internalPostEditButtonHTML() hiện nút Sửa cho bài APPROVED', async () => {
      const html = await page.evaluate((p) => internalPostEditButtonHTML(p), approvedPost);
      assert(html.includes('editInternalPostUI'), `Phải có nút Sửa, got: ${html}`);
    });

    await run('editInternalPostUI(APPROVED): mở form, editingInternalPostId đúng, nhãn nút Gửi = "Lưu Thay Đổi", nút "Lưu Nháp" bị ẩn', async () => {
      await page.evaluate((id) => editInternalPostUI(id), approvedPost.id);
      const r = await page.evaluate(() => ({
        editingId: editingInternalPostId,
        submitLabel: document.getElementById('internalSubmitBtn')?.innerText,
        draftBtnHidden: document.getElementById('internalDraftBtn')?.classList.contains('hidden')
      }));
      assertEqual(r.editingId, approvedPost.id, 'editingInternalPostId');
      assertEqual(r.submitLabel, 'Lưu Thay Đổi', 'submitLabel');
      assertEqual(r.draftBtnHidden, true, 'draftBtnHidden');
    });

    await run('ĐỐI CHỨNG: Sửa bài DRAFT khác -> nút "Lưu Nháp" hiện lại, nhãn nút Gửi vẫn là "Gửi" như cũ', async () => {
      await page.evaluate((id) => editInternalPostUI(id), draftPost.id);
      const r = await page.evaluate(() => ({
        draftBtnHidden: document.getElementById('internalDraftBtn')?.classList.contains('hidden'),
        submitLabel: document.getElementById('internalSubmitBtn')?.innerText
      }));
      assertEqual(r.draftBtnHidden, false, 'draftBtnHidden phải hiện lại cho bài DRAFT');
      assertEqual(r.submitLabel, 'Gửi', 'submitLabel phải vẫn là Gửi cho bài DRAFT');
    });

    await run('ĐỐI CHỨNG: Huỷ Sửa -> nút "Lưu Nháp" hiện lại (quay về chế độ Đăng bài mới)', async () => {
      await page.evaluate((id) => editInternalPostUI(id), approvedPost.id);
      await page.evaluate(() => cancelEditInternalPost());
      const hidden = await page.evaluate(() => document.getElementById('internalDraftBtn')?.classList.contains('hidden'));
      assertEqual(hidden, false, 'draftBtnHidden sau khi huỷ Sửa');
    });

    await run('Không có lỗi JS chưa bắt (pageerror) nào phát sinh trong suốt bài test', () => {
      assertEqual(pageErrors.length, 0, JSON.stringify(pageErrors));
    });
  } finally {
    await teardown(server, browser);
  }
  summarize();
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
