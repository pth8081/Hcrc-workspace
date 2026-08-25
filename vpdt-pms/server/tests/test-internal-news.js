// tests/test-internal-news.js — Truyền Thông Nội Bộ > Tin Nội Bộ (NEWS sub-tab).
// Facebook-style feed: create post, inline comments, sensitive-keyword auto-flagging, moderation
// (dismiss/delete flagged comment), like toggle, permission-denied create.
//
// Run: node server/tests/test-internal-news.js
const path = require('path');
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8991;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    // Admin — allowed to post NEWS and to moderate comments (internalPostApprove implied by admin).
    const admin = makeUser({ username: 'admin1', name: 'Quản Trị Viên', dept: 'Phòng CNTT', perms: { admin: true } });
    // Ordinary staff — no internalNewsCreate permission, used for the permission-denied scenario and
    // as a commenter.
    const staff = makeUser({ username: 'nv.an', name: 'Nguyễn Văn An', dept: 'Phòng Nhân Sự', perms: {} });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((u) => { DB.users = [u]; }, admin);
    await page.evaluate((u) => finishLogin(u), admin);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('NEWS'); });

    let createdPostId = null;

    await run('admin creates a NEWS post and it renders in the feed as APPROVED', async () => {
      await page.evaluate(() => {
        document.getElementById('internalTitle').value = 'Thông báo nghỉ lễ 2/9';
        document.getElementById('internalContent').value = 'Công ty nghỉ lễ Quốc khánh từ ngày 1/9 đến 3/9.';
      });
      await page.evaluate(() => submitInternalPost({ preventDefault() {}, target: { reset() {} } }));

      const posts = await page.evaluate(() => DB.internalPosts.map((p) => ({ id: p.id, title: p.title, status: p.status, type: p.type })));
      assertEqual(posts.length, 1, 'expected exactly 1 post in DB.internalPosts');
      assertEqual(posts[0].title, 'Thông báo nghỉ lễ 2/9', 'post title mismatch');
      assertEqual(posts[0].status, 'APPROVED', 'NEWS posts by an allowed creator should be auto-APPROVED');
      createdPostId = posts[0].id;

      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('Đã đăng bài thành công')), `expected success alert, got: ${JSON.stringify(alerts)}`);

      const feedHTML = await page.evaluate(() => document.getElementById('internalPostsContainer').innerHTML);
      assert(feedHTML.includes('Thông báo nghỉ lễ 2/9'), 'feed HTML should contain the new post title');
    });

    await run('staff without internalNewsCreate permission is blocked from posting NEWS', async () => {
      await page.evaluate((u) => { DB.users.push(u); }, staff);
      await page.evaluate((u) => { currentUser = u; }, staff);
      await page.evaluate(() => { window.__alerts.length = 0; });
      await page.evaluate(() => {
        document.getElementById('internalTitle').value = 'Bài viết không được phép';
        document.getElementById('internalContent').value = 'Nội dung...';
      });
      const countBefore = await page.evaluate(() => DB.internalPosts.length);
      await page.evaluate(() => submitInternalPost({ preventDefault() {}, target: { reset() {} } }));
      const countAfter = await page.evaluate(() => DB.internalPosts.length);
      assertEqual(countAfter, countBefore, 'post count should not change when creation is blocked client-side');
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some((a) => a.includes('không có quyền đăng bài')), `expected permission-denied alert, got: ${JSON.stringify(alerts)}`);
      // restore admin for the remaining scenarios
      await page.evaluate((u) => { currentUser = u; }, admin);
    });

    await run('comment containing a sensitive keyword is auto-flagged for moderation', async () => {
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('NEWS'); });
      await page.evaluate((id) => {
        document.getElementById(`internalCommentInput_${id}`).value = 'Nhóm mình đang bàn chuyện nghỉ việc tập thể vì lương thấp';
      }, createdPostId);
      await page.evaluate((id) => addInternalCommentInline(id), createdPostId);

      const post = await page.evaluate((id) => DB.internalPosts.find((p) => p.id === id), createdPostId);
      assertEqual(post.comments.length, 1, 'expected 1 comment on the post');
      assert(post.comments[0].flagged === true, 'comment mentioning a sensitive keyword should be flagged');
      assert(post.comments[0].flagCategories.includes('RISK'), `expected RISK category, got ${JSON.stringify(post.comments[0].flagCategories)}`);
    });

    let flaggedCommentId = null;
    await run('a second sensitive comment is added for the delete-flagged-comment scenario', async () => {
      await page.evaluate((id) => {
        document.getElementById(`internalCommentInput_${id}`).value = 'Đừng chửi nhau trong nhóm nữa';
      }, createdPostId);
      await page.evaluate((id) => addInternalCommentInline(id), createdPostId);
      const post = await page.evaluate((id) => DB.internalPosts.find((p) => p.id === id), createdPostId);
      assertEqual(post.comments.length, 2, 'expected 2 comments now');
      assert(post.comments[1].flagged === true, 'second comment should also be auto-flagged (contains "chửi")');
      flaggedCommentId = post.comments[1].id;
    });

    await run('moderator dismisses the first flagged comment (no violation found)', async () => {
      const firstCommentId = await page.evaluate((id) => DB.internalPosts.find((p) => p.id === id).comments[0].id, createdPostId);
      await page.evaluate(({ id, cid }) => dismissCommentFlagAction(id, cid), { id: createdPostId, cid: firstCommentId });
      const post = await page.evaluate((id) => DB.internalPosts.find((p) => p.id === id), createdPostId);
      assertEqual(post.comments[0].flagged, false, 'dismissed comment should no longer be flagged');
      assertEqual(post.comments[0].flagDismissedBy, 'admin1', 'flagDismissedBy should record the moderator');
      assertEqual(post.comments.length, 2, 'dismiss should NOT delete the comment');
    });

    await run('moderator deletes the second flagged (violating) comment', async () => {
      await page.evaluate(({ id, cid }) => deleteFlaggedCommentAction(id, cid), { id: createdPostId, cid: flaggedCommentId });
      const post = await page.evaluate((id) => DB.internalPosts.find((p) => p.id === id), createdPostId);
      assertEqual(post.comments.length, 1, 'deleting the flagged comment should remove it from the post');
      assert(!post.comments.some((c) => c.id === flaggedCommentId), 'deleted comment id should no longer be present');
    });

    await run('like toggles on and off', async () => {
      await page.evaluate((id) => toggleInternalLikeInline(id), createdPostId);
      let post = await page.evaluate((id) => DB.internalPosts.find((p) => p.id === id), createdPostId);
      assert(post.likes.includes('admin1'), 'like should be recorded for admin1');
      await page.evaluate((id) => toggleInternalLikeInline(id), createdPostId);
      post = await page.evaluate((id) => DB.internalPosts.find((p) => p.id === id), createdPostId);
      assert(!post.likes.includes('admin1'), 'second toggle should remove the like');
    });

    assertEqual(pageErrors.length, 0, `unexpected uncaught page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-internal-news.js');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
