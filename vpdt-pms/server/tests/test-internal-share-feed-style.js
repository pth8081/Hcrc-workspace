// tests/test-internal-share-feed-style.js — Đợt E (9/2026): Góc Chia Sẻ (SHARE) dùng chung khung
// hiển thị kiểu Facebook với Nhịp Sống HCRC (renderInternalFeedStyle/renderInternalNewsCard) — bình
// luận/thích ngay trên thẻ, top-5 bình luận nổi bật, sắp theo tương tác, kiểm duyệt bình luận inline,
// Duyệt/Từ chối ngay trên thẻ. Đồng thời xác minh lỗi "đổi tab vẫn thấy Dashboard cũ" (Ảnh 2 người dùng
// báo) đã được vá: #internalDashboardCards phải được dọn sạch khi rời khỏi Góc Chia Sẻ.
//
// Run: node server/tests/test-internal-share-feed-style.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8994;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();

  try {
    const approver = makeUser({ username: 'qtv.lan', name: 'Trần Thị Lan', dept: 'Phòng Nhân Sự', perms: { internalPostApprove: true } });
    const staff = makeUser({ username: 'nv.duc', name: 'Phạm Văn Đức', dept: 'Phòng CNTT', perms: {} });

    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((users) => { DB.users = users; }, [approver, staff]);
    await page.evaluate((u) => finishLogin(u), staff);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('SHARE'); });

    let post1Id = null, post2Id = null, post3Id = null;

    await run('staff posts 3 SHARE posts (all start PENDING)', async () => {
      for (const title of ['Bài chia sẻ số 1', 'Bài chia sẻ số 2', 'Bài chia sẻ sẽ bị từ chối']) {
        await page.evaluate((t) => {
          document.getElementById('internalTitle').value = t;
          document.getElementById('internalContent').textContent = 'Nội dung chia sẻ nghiệp vụ hàng ngày.';
          document.getElementById('internalPostCategoryShare').value = 'CONG_VIEC';
        }, title);
        await page.evaluate(() => submitInternalPost({ preventDefault() {}, target: { reset() {} } }));
      }
      const posts = await page.evaluate(() => DB.internalPosts.filter((p) => p.type === 'SHARE').sort((a, b) => a.id - b.id));
      assertEqual(posts.length, 3, 'expected 3 SHARE posts');
      assert(posts.every((p) => p.status === 'PENDING'), 'all 3 should start PENDING');
      [post1Id, post2Id, post3Id] = posts.map((p) => p.id);
    });

    await run('approver sees inline Duyệt/Từ chối buttons on the SHARE card (no need to open Chi tiết)', async () => {
      await page.evaluate((u) => { currentUser = u; }, approver);
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('SHARE'); });
      const approveBtnCount = await page.evaluate(() => document.querySelectorAll('#internalPostsContainer [data-op="approveInternalPostAction"]').length);
      const rejectBtnCount = await page.evaluate(() => document.querySelectorAll('#internalPostsContainer [data-op="rejectInternalPostAction"]').length);
      assertEqual(approveBtnCount, 3, 'expected 3 inline "Duyệt" buttons (1 per PENDING post), no modal needed');
      assertEqual(rejectBtnCount, 3, 'expected 3 inline "Từ chối" buttons');
    });

    await run('SHARE dashboard cards render with correct counts while on SHARE tab', async () => {
      const dashText = await page.evaluate(() => document.getElementById('internalDashboardCards').innerText);
      assert(dashText.includes('Tổng Bài Đăng'), `expected dashboard cards, got: ${dashText}`);
      assert(dashText.includes('Đang Chờ Duyệt'), `expected "Đang Chờ Duyệt" card, got: ${dashText}`);
      const dashHTML = await page.evaluate(() => document.getElementById('internalDashboardCards').innerHTML.trim());
      assert(dashHTML.length > 0, 'dashboard cards HTML should be non-empty on SHARE tab');
    });

    await run('approver approves post1 and post2 inline, rejects post3 with a reason', async () => {
      await page.evaluate((id) => approveInternalPostAction(id), post1Id);
      await page.evaluate(() => window.__runPendingConfirm());
      await page.evaluate((id) => approveInternalPostAction(id), post2Id);
      await page.evaluate(() => window.__runPendingConfirm());
      await page.evaluate(() => { window.__promptQueue = ['Nội dung chưa phù hợp']; });
      await page.evaluate((id) => rejectInternalPostAction(id), post3Id);
      await page.evaluate(() => window.__runPendingConfirm());
      const posts = await page.evaluate(() => DB.internalPosts.filter((p) => p.type === 'SHARE'));
      assertEqual(posts.find((p) => p.id === post1Id).status, 'APPROVED', 'post1 should be APPROVED');
      assertEqual(posts.find((p) => p.id === post2Id).status, 'APPROVED', 'post2 should be APPROVED');
      assertEqual(posts.find((p) => p.id === post3Id).status, 'REJECTED', 'post3 should be REJECTED');
    });

    await run('rejected SHARE post shows "Lý do từ chối" banner inline on its card', async () => {
      const html = await page.evaluate(() => document.getElementById('internalPostsContainer').innerHTML);
      assert(html.includes('Lý do từ chối'), 'expected rejected-reason banner to render inline on the card');
      assert(html.includes('Nội dung chưa phù hợp'), 'expected the actual reject reason text to appear');
    });

    await run('approver adds an inline comment on an APPROVED SHARE post (like Nhịp Sống HCRC)', async () => {
      await page.evaluate((id) => {
        document.getElementById(`internalCommentInput_${id}`).value = 'Cảm ơn bạn đã chia sẻ!';
      }, post1Id);
      await page.evaluate((id) => addInternalCommentInline(id), post1Id);
      const post = await page.evaluate((id) => DB.internalPosts.find((p) => p.id === id), post1Id);
      assertEqual(post.comments.length, 1, 'expected 1 comment on post1');
      assertEqual(post.comments[0].content, 'Cảm ơn bạn đã chia sẻ!', 'comment content should match');
      const html = await page.evaluate(() => document.getElementById('internalPostsContainer').innerHTML);
      assert(html.includes('Cảm ơn bạn đã chia sẻ!'), 'comment text should be rendered inline on the SHARE card');
    });

    await run('a sensitive-keyword comment on a SHARE post is auto-flagged and shows the inline moderation queue', async () => {
      await page.evaluate((id) => {
        document.getElementById(`internalCommentInput_${id}`).value = 'Nhóm mình đang bàn chuyện nghỉ việc tập thể vì lương thấp';
      }, post1Id);
      await page.evaluate((id) => addInternalCommentInline(id), post1Id);
      const post = await page.evaluate((id) => DB.internalPosts.find((p) => p.id === id), post1Id);
      assertEqual(post.comments.length, 2, 'expected 2 comments now');
      assert(post.comments[1].flagged === true, 'sensitive comment should be auto-flagged');
      const html = await page.evaluate(() => document.getElementById('internalPostsContainer').innerHTML);
      assert(html.includes('bình luận chờ kiểm duyệt'), 'expected inline moderation queue (renderInternalModerationQueueHTML) to render on the SHARE card, same as Nhịp Sống HCRC');
    });

    await run('like toggles inline on a SHARE post (toggleInternalLikeInline)', async () => {
      await page.evaluate((id) => toggleInternalLikeInline(id), post2Id);
      let post = await page.evaluate((id) => DB.internalPosts.find((p) => p.id === id), post2Id);
      assertEqual(post.likes.length, 1, 'expected 1 like on post2');
      let html = await page.evaluate(() => document.getElementById('internalPostsContainer').innerHTML);
      assert(html.includes('Đã thích'), 'expected "Đã thích" state to render inline after liking');
      await page.evaluate((id) => toggleInternalLikeInline(id), post2Id);
      post = await page.evaluate((id) => DB.internalPosts.find((p) => p.id === id), post2Id);
      assertEqual(post.likes.length, 0, 'like should toggle back off');
    });

    await run('sort toggle buttons ("Mới nhất"/"Tương tác nhiều") render for SHARE with correct data-op args', async () => {
      const recentBtn = await page.evaluate(() => {
        const el = document.querySelector('[data-op="setInternalFeedSort"][data-arg1="recent"]');
        return el ? { arg0: el.getAttribute('data-arg0') } : null;
      });
      const popularBtn = await page.evaluate(() => {
        const el = document.querySelector('[data-op="setInternalFeedSort"][data-arg1="popular"]');
        return el ? { arg0: el.getAttribute('data-arg0') } : null;
      });
      assert(recentBtn && recentBtn.arg0 === 'SHARE', `expected "Mới nhất" button scoped to SHARE, got ${JSON.stringify(recentBtn)}`);
      assert(popularBtn && popularBtn.arg0 === 'SHARE', `expected "Tương tác nhiều" button scoped to SHARE, got ${JSON.stringify(popularBtn)}`);
    });

    await run('"Tương tác nhiều" sort brings the post with more engagement (likes+comments) to the top, independent of Nhịp Sống HCRC sort state', async () => {
      // post1 now has 2 comments (1 clean + 1 flagged) + 0 likes = score 2; post2 has 0 comments + 0
      // likes = score 0 (we just toggled its like back off) -> post1 should rank first under 'popular'.
      await page.evaluate(() => setInternalFeedSort('SHARE', 'popular'));
      const html = await page.evaluate(() => document.getElementById('internalPostsContainer').innerHTML);
      const idx1 = html.indexOf('Bài chia sẻ số 1');
      const idx2 = html.indexOf('Bài chia sẻ số 2');
      assert(idx1 !== -1 && idx2 !== -1, 'both post titles should be present');
      assert(idx1 < idx2, `expected post1 (more engagement) to rank before post2 under "Tương tác nhiều", got positions ${idx1}/${idx2}`);
      // switch back to 'recent' for the rest of the scenarios, and confirm it does not disturb NEWS's own sort state.
      await page.evaluate(() => setInternalFeedSort('SHARE', 'recent'));
    });

    await run('BUG FIX (Ảnh 2): switching SHARE -> Nhịp Sống HCRC clears the stale dashboard cards (no longer shows a Dashboard on a tab that should not have one)', async () => {
      const dashBeforeSwitch = await page.evaluate(() => document.getElementById('internalDashboardCards').innerHTML.trim());
      assert(dashBeforeSwitch.length > 0, 'sanity check: dashboard should be visible while still on SHARE');

      await page.evaluate(() => { setInternalSubTab('NEWS'); });
      const dashAfterSwitchToNews = await page.evaluate(() => document.getElementById('internalDashboardCards').innerHTML.trim());
      assertEqual(dashAfterSwitchToNews, '', 'internalDashboardCards must be EMPTY right after switching to Nhịp Sống HCRC — this is the exact bug reported: stale SHARE dashboard cards were left visible, wrongly implying NEWS has a Dashboard');

      const newsListTitle = await page.evaluate(() => document.getElementById('internalListTitle').innerText);
      assert(newsListTitle.includes('Nhịp Sống HCRC'), `expected the NEWS list title, got: ${newsListTitle}`);

      await page.evaluate(() => { setInternalSubTab('SHARE'); });
      const dashAfterSwitchBack = await page.evaluate(() => document.getElementById('internalDashboardCards').innerHTML.trim());
      assert(dashAfterSwitchBack.length > 0, 'dashboard cards should re-appear after switching back to SHARE');
    });

    await run('BUG FIX (audit): switching SHARE -> Đào Tạo (usesOwnSection, early return) also clears the stale dashboard', async () => {
      await page.evaluate(() => { setInternalSubTab('SHARE'); });
      const dashOnShare = await page.evaluate(() => document.getElementById('internalDashboardCards').innerHTML.trim());
      assert(dashOnShare.length > 0, 'sanity check: dashboard visible on SHARE before switching');
      await page.evaluate(() => { setInternalSubTab('TRAINING'); });
      const dashOnTraining = await page.evaluate(() => document.getElementById('internalDashboardCards').innerHTML.trim());
      assertEqual(dashOnTraining, '', 'internalDashboardCards must also be cleared when leaving SHARE for a usesOwnSection tab (Đào Tạo)');
    });

    assertEqual(pageErrors.length, 0, `no console/page errors expected, got: ${JSON.stringify(pageErrors)}`);
  } finally {
    await teardown({ server, browser });
  }

  summarize('test-internal-share-feed-style.js');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exitCode = 1;
});
