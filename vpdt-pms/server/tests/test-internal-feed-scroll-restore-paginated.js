'use strict';

// tests/test-internal-feed-scroll-restore-paginated.js
//
// LỖI ĐÃ VÁ (11/2026, người dùng báo "Trang chủ => Xem thêm => thoát ra đang bị nhảy vào Nhịp Sống HCRC"
// thay vì về đúng bài ban đầu): closeInternalArticleModal() (module-internalcomms-nhipsong.js) trước đây
// CHỈ document.getElementById(`internalFeedCard_${id}`)?.scrollIntoView(...) — im lặng bỏ qua nếu thẻ đó
// không nằm trong TRANG đang hiển thị (feed phân trang 10 bài/trang). Trang chủ (renderDashboardNews(),
// core-dashboard.js) luôn đẩy bài ĐANG GHIM lên đầu bất kể cũ/mới, nhưng renderInternalFeedStyle() không
// ưu tiên bài ghim trong sắp xếp "Mới nhất" thường -> 1 bài ghim NHƯNG cũ (quá trang 1 theo id giảm dần)
// hiện NGAY ở Trang chủ, nhưng bấm "Xem thêm" rồi thoát lại rơi đúng vào thẻ không nằm ở trang 1 này.
//
// Test này dựng ĐÚNG kịch bản đó: nhiều bài hơn 1 trang (10 bài/trang), ghim 1 bài CŨ (id nhỏ, đứng
// ngoài trang 1 theo "Mới nhất"), mô phỏng bấm "Xem thêm" từ Trang chủ rồi đóng modal — xác nhận cuộn
// đúng về thẻ bài đó (tự chuyển sang đúng trang chứa nó trước khi cuộn).
//
// Chạy: node tests/test-internal-feed-scroll-restore-paginated.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8972;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();
  try {
    const admin = makeUser({ username: 'admin1', name: 'Quản Trị Viên', perms: { admin: true } });
    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((u) => { DB.users = [u]; }, admin);
    await page.evaluate((u) => finishLogin(u), admin);

    // 15 bài NEWS, id tăng dần (id lớn = mới hơn). Bài id=1 (CŨ NHẤT) được GHIM còn hạn -> Trang chủ sẽ
    // hiện bài này ĐẦU TIÊN (ưu tiên ghim), nhưng trong "Mới nhất" (renderInternalFeedStyle mặc định,
    // không ưu tiên ghim) bài id=1 đứng CUỐI CÙNG trong 15 bài -> rơi vào TRANG 2 (trang 1 chỉ có 10 bài
    // mới nhất, id 15..6).
    await page.evaluate(() => {
      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      DB.internalPosts = Array.from({ length: 15 }, (_, i) => {
        const id = i + 1;
        const base = { id, type: 'NEWS', status: 'APPROVED', title: `Bài số ${id}`, authorName: 'A', createdAt: '1/1/2026', content: `Nội dung bài ${id}`, likes: [], comments: [], readBy: [] };
        if (id === 1) return { ...base, pinned: true, pinExpiresAt: future };
        return base;
      });
    });

    await run('setup: Trang chủ hiện bài id=1 (ghim) ở vị trí ĐẦU TIÊN dù là bài cũ nhất', async () => {
      await page.evaluate(() => { switchTab('dashboard'); renderDashboardNews(); });
      const firstCardId = await page.evaluate(() => {
        const card = document.querySelector('#dashboardNewsContainer .dash-news-card');
        return Number(card.getAttribute('data-op-seq').match(/viewInternalPostDetail\((\d+)\)/)[1]);
      });
      assertEqual(firstCardId, 1, 'bài ghim (id=1, cũ nhất) phải hiện đầu tiên ở Trang chủ');
    });

    await run('"Mới nhất" (Nhịp Sống HCRC) KHÔNG ưu tiên ghim -> bài id=1 rơi vào TRANG 2 (trang 1 chỉ có id 15..6)', async () => {
      await page.evaluate(() => { switchTab('internal'); setInternalSubTab('NEWS'); });
      const page1Ids = await page.evaluate(() => [...document.querySelectorAll('#internalPostsContainer [id^="internalFeedCard_"]')]
        .map(el => Number(el.id.replace('internalFeedCard_', ''))));
      assert(!page1Ids.includes(1), `trang 1 "Mới nhất" KHÔNG được chứa bài id=1 (tiền đề của lỗi) — thực tế: ${JSON.stringify(page1Ids)}`);
      assertEqual(page1Ids.length, 10, 'trang 1 phải đủ 10 bài (pageSize mặc định)');
    });

    await run('Trang chủ > "Xem thêm" bài id=1 (ghim, trang 2) > đóng modal: PHẢI tự chuyển sang trang 2 rồi cuộn đúng vào thẻ bài id=1', async () => {
      await page.evaluate(() => { switchTab('dashboard'); renderDashboardNews(); });
      // Bấm "Xem thêm" của bài id=1 ngay trên Trang chủ — mô phỏng đúng data-op-seq thật
      // (switchTab('internal')|setInternalSubTab('NEWS')|viewInternalPostDetail(1)).
      await page.click('[data-op-seq*="viewInternalPostDetail(1)"] .dash-news-more');
      await page.waitForTimeout(300);
      const modalVisible = await page.evaluate(() => !document.getElementById('internalArticleModal').classList.contains('hidden'));
      assert(modalVisible, 'modal Chi tiết phải mở ra sau khi bấm Xem thêm');

      await page.evaluate(() => closeInternalArticleModal());
      await page.waitForTimeout(300);

      const result = await page.evaluate(() => {
        const card = document.getElementById('internalFeedCard_1');
        if (!card) return { cardExists: false };
        const r = card.getBoundingClientRect();
        return { cardExists: true, inViewport: r.top >= 0 && r.top < window.innerHeight, currentPage: getListPageState('internalNews').page };
      });
      assert(result.cardExists, 'LỖI (nếu fail): thẻ bài id=1 KHÔNG tồn tại trong DOM sau khi đóng modal — nghĩa là vẫn đang ở trang 1, chưa tự chuyển sang trang 2 chứa bài đó');
      assertEqual(result.currentPage, 2, 'phải tự chuyển sang trang 2 (trang chứa bài id=1 trong "Mới nhất")');
      assert(result.inViewport, 'thẻ bài id=1 phải nằm trong khung nhìn (đã cuộn tới) sau khi đóng modal');
    });

    assertEqual(pageErrors.length, 0, `unexpected page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
    summarize('test-internal-feed-scroll-restore-paginated.js');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
