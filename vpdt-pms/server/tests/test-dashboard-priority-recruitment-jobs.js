// tests/test-dashboard-priority-recruitment-jobs.js — Trang chủ > khung "📣 Tin Tức Nổi Bật"
// (renderDashboardNews(), core-dashboard.js). Theo yêu cầu người dùng (11/2026, kèm ảnh chụp "Tin ưu
// tiên" ở tab Tuyển Dụng): "các tin ưu tiên sẽ được mặc định hiển thị ở trang chủ trong phần tin tức
// nổi bật khi người dùng đăng nhập vào là sẽ thấy".
//
// Đã vá: renderDashboardNews() merge thêm DB.recruitmentJobs đang "🔥 Tin ưu tiên" (pinned && status
// OPEN — mirror ĐÚNG isRecruitmentJobPriority(), module-internalcomms-nhipsong.js) vào đầu danh sách
// hiển thị, dùng khung thẻ riêng (field khác internalPosts: bannerUrl/hiringDept, không có nội dung bài
// viết). Click thẻ -> openRecruitmentJobFromDashboard() (module mới) điều hướng sang tab Tuyển Dụng,
// tự mở rộng mô tả + cuộn tới đúng thẻ tin đó (không có modal chi tiết riêng như internalPosts).
//
// Run: node tests/test-dashboard-priority-recruitment-jobs.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8995;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();
  try {
    const nv1 = makeUser({ username: 'nv1', name: 'Nhân Viên Thường', perms: {} });
    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((u) => { DB.users = [u]; }, nv1);
    await page.evaluate((u) => finishLogin(u), nv1);

    await page.evaluate(() => {
      DB.internalPosts = [
        { id: 7001, type: 'NEWS', status: 'APPROVED', title: 'Tin tức thường (không ghim)', authorName: 'A', createdAt: '1/11/2026', likes: [], comments: [], readBy: [] }
      ];
      DB.recruitmentJobs = [
        { id: 8001, title: 'Tin tuyển dụng ưu tiên', status: 'OPEN', pinned: true, pinnedAt: '2026-11-01T10:00:00.000Z',
          hiringDept: 'Siêu thị số 390 Nguyễn Văn Cừ', location: 'Hà Nội', creator: 'hr1', creatorName: 'HR' },
        { id: 8002, title: 'Tin tuyển dụng thường (không ưu tiên)', status: 'OPEN', pinned: false,
          hiringDept: 'Siêu thị khác', creator: 'hr1', creatorName: 'HR' },
        { id: 8003, title: 'Tin ĐÃ từng ưu tiên nhưng đã đóng tuyển', status: 'FILLED', pinned: true, pinnedAt: '2026-11-01T09:00:00.000Z',
          hiringDept: 'Siêu thị khác 2', creator: 'hr1', creatorName: 'HR' }
      ];
      switchTab('dashboard');
      renderDashboardNews();
    });

    await run('Tin tuyển dụng "🔥 Tin ưu tiên" (pinned + OPEN) PHẢI hiện ở khung Tin Tức Nổi Bật Trang chủ', async () => {
      const titles = await page.evaluate(() => [...document.querySelectorAll('#dashboardNewsContainer .dash-news-card')].map(c => c.textContent));
      assert(titles.some(t => t.includes('Tin tuyển dụng ưu tiên')), 'phải có thẻ tin tuyển dụng ưu tiên: ' + JSON.stringify(titles));
    });

    await run('Tin tuyển dụng KHÔNG ưu tiên (pinned=false) KHÔNG được lọt vào khung Trang chủ', async () => {
      const titles = await page.evaluate(() => [...document.querySelectorAll('#dashboardNewsContainer .dash-news-card')].map(c => c.textContent));
      assert(!titles.some(t => t.includes('Tin tuyển dụng thường')), 'không được hiện tin không ưu tiên: ' + JSON.stringify(titles));
    });

    await run('Tin ĐÃ pinned nhưng status khác OPEN (FILLED) KHÔNG còn tính là ưu tiên -> KHÔNG hiện (mirror đúng isRecruitmentJobPriority())', async () => {
      const titles = await page.evaluate(() => [...document.querySelectorAll('#dashboardNewsContainer .dash-news-card')].map(c => c.textContent));
      assert(!titles.some(t => t.includes('Tin ĐÃ từng ưu tiên nhưng đã đóng tuyển')), 'không được hiện tin pinned nhưng đã FILLED: ' + JSON.stringify(titles));
    });

    await run('Tin ưu tiên tuyển dụng xếp TRƯỚC tin tức Nhịp Sống trong danh sách (đúng ưu tiên "cần tuyển gấp")', async () => {
      const order = await page.evaluate(() => [...document.querySelectorAll('#dashboardNewsContainer .dash-news-card')].map(c => c.getAttribute('data-op')));
      assertEqual(order[0], 'openRecruitmentJobFromDashboard', 'thẻ đầu tiên phải là tin tuyển dụng ưu tiên: ' + JSON.stringify(order));
    });

    await run('Thẻ tin ưu tiên có nhãn "🔥 Tin ưu tiên" + đúng data-arg0 = id tin tuyển dụng', async () => {
      const card = await page.evaluate(() => {
        const c = document.querySelector('#dashboardNewsContainer [data-op="openRecruitmentJobFromDashboard"]');
        return c ? { html: c.innerHTML, arg0: c.getAttribute('data-arg0') } : null;
      });
      assert(!!card, 'phải tìm thấy thẻ tin tuyển dụng ưu tiên');
      assert(card.html.includes('🔥 Tin ưu tiên'), 'phải có nhãn 🔥 Tin ưu tiên');
      assertEqual(card.arg0, '8001', 'data-arg0 phải đúng id tin tuyển dụng');
    });

    await run('Tiêu đề/địa chỉ được escapeHtml (không chèn thẻ HTML thô)', async () => {
      await page.evaluate(() => {
        DB.recruitmentJobs.unshift({ id: 8099, title: 'Tin <script>alert(1)</script>', status: 'OPEN', pinned: true, pinnedAt: '2026-11-02T10:00:00.000Z', hiringDept: 'X', creator: 'hr1', creatorName: 'HR' });
        renderDashboardNews();
      });
      const html = await page.evaluate(() => document.getElementById('dashboardNewsContainer').innerHTML);
      assert(html.includes('Tin &lt;script&gt;alert(1)&lt;/script&gt;'), 'tiêu đề phải được escapeHtml, không chèn thẻ thô');
      assert(!html.includes('<script>alert(1)</script>'), 'KHÔNG được có thẻ script thô trong HTML');
      // Dọn lại đúng fixture ban đầu cho các kịch bản click thật ngay dưới đây.
      await page.evaluate(() => { DB.recruitmentJobs.shift(); renderDashboardNews(); });
    });

    await run('Click thẻ tin ưu tiên -> điều hướng sang tab Tuyển Dụng, tự mở rộng đúng tin đó (không lỗi JS)', async () => {
      pageErrors.length = 0;
      await page.click('#dashboardNewsContainer [data-op="openRecruitmentJobFromDashboard"]');
      await page.waitForTimeout(300);
      const state = await page.evaluate(() => ({
        activeTopTab: typeof activeTopTabName !== 'undefined' ? activeTopTabName : null,
        activeSubTab: typeof activeInternalSubTab !== 'undefined' ? activeInternalSubTab : null,
        sectionHidden: document.getElementById('internalRecruitmentSection').classList.contains('hidden'),
        expanded: typeof expandedRecruitmentJobs !== 'undefined' ? expandedRecruitmentJobs.has(8001) : null,
        cardExists: !!document.querySelector('#recruitmentJobsContainer .rj-card[data-job-id="8001"]')
      }));
      assertEqual(state.activeSubTab, 'RECRUITMENT', 'phải chuyển đúng sang tab con Tuyển Dụng: ' + JSON.stringify(state));
      assert(!state.sectionHidden, 'khung Tuyển Dụng phải hiện ra: ' + JSON.stringify(state));
      assert(state.expanded === true, 'job vừa click phải được tự mở rộng (expandedRecruitmentJobs): ' + JSON.stringify(state));
      assert(state.cardExists, 'thẻ tin tuyển dụng đúng id phải có trong danh sách Tuyển Dụng: ' + JSON.stringify(state));
      assertEqual(pageErrors.length, 0, 'không được có lỗi JS: ' + pageErrors.map(e => e.message).join(' | '));
    });

    await run('Không có on*=/style= nội tuyến trong HTML Trang chủ (CSP)', async () => {
      await page.evaluate(() => { switchTab('dashboard'); renderDashboardNews(); });
      const html = await page.evaluate(() => document.getElementById('dashboardNewsContainer').innerHTML);
      assert(!/\son[a-z]+\s*=/i.test(html), 'không được có onXxx= nội tuyến');
      assert(!/\sstyle\s*=/i.test(html), 'không được có style= nội tuyến');
    });

    summarize('test-dashboard-priority-recruitment-jobs.js');
  } finally {
    await teardown({ server, browser });
  }
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
