'use strict';

// tests/test-internal-feed-scroll-restore-paginated.js
//
// LỖI ĐÃ VÁ (11/2026): closeInternalArticleModal() (module-internalcomms-nhipsong.js) trước đây CHỈ
// document.getElementById(`internalFeedCard_${id}`)?.scrollIntoView(...) — im lặng bỏ qua nếu thẻ đó
// không nằm trong TRANG đang hiển thị (feed phân trang 10 bài/trang).
//
// NƠI LỖI NÀY CÒN XẢY RA (sau khi Trang chủ "Xem thêm" đổi sang ở lại Trang chủ, KHÔNG còn chuyển tab —
// xem test-dashboard-news-thumbnail.js): bất kỳ lối mở viewInternalPostDetail(id) TRỰC TIẾP nào không đi
// qua đúng trang/bộ lọc hiện có của feed, ví dụ link nhắc nhở trong email (openLinkedApprovalRecordByCode()
// ở core.js, bảng INTERNAL: { open: (r) => viewInternalPostDetail(r.id) }) — người dùng bấm link email mở
// 1 bài CŨ (VD đang ghim, hoặc chế độ sắp xếp "Tương tác nhiều"/bộ lọc còn sót khiến bài đó rơi ra ngoài
// trang 1) trong lúc đang xem Nhịp Sống HCRC ở trang 1 — đóng modal ra phải cuộn đúng về bài đó, không
// được "rơi" về đầu trang 1 vì thẻ chưa có trong DOM.
//
// Test này dựng ĐÚNG kịch bản đó: nhiều bài hơn 1 trang (10 bài/trang), ghim 1 bài CŨ (rơi ra ngoài trang
// 1 theo "Mới nhất" mặc định — renderInternalFeedStyle() không ưu tiên ghim), mô phỏng mở
// viewInternalPostDetail() trực tiếp (như link email) trong khi đang ở trang 1 của Nhịp Sống HCRC, rồi
// đóng modal — xác nhận tự chuyển sang đúng trang chứa bài đó trước khi cuộn.
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

    // 15 bài NEWS, id tăng dần (id lớn = mới hơn). Bài id=1 (CŨ NHẤT) được GHIM còn hạn — trong "Mới
    // nhất" (renderInternalFeedStyle mặc định, không ưu tiên ghim) bài id=1 đứng CUỐI CÙNG trong 15 bài
    // -> rơi vào TRANG 2 (trang 1 chỉ có 10 bài mới nhất, id 15..6).
    await page.evaluate(() => {
      const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      DB.internalPosts = Array.from({ length: 15 }, (_, i) => {
        const id = i + 1;
        const base = { id, type: 'NEWS', status: 'APPROVED', title: `Bài số ${id}`, authorName: 'A', createdAt: '1/1/2026', content: `Nội dung bài ${id}`, likes: [], comments: [], readBy: [] };
        if (id === 1) return { ...base, pinned: true, pinExpiresAt: future };
        return base;
      });
      switchTab('internal');
      setInternalSubTab('NEWS');
    });

    await run('"Mới nhất" (Nhịp Sống HCRC) KHÔNG ưu tiên ghim -> bài id=1 rơi vào TRANG 2 (trang 1 chỉ có id 15..6)', async () => {
      const page1Ids = await page.evaluate(() => [...document.querySelectorAll('#internalPostsContainer [id^="internalFeedCard_"]')]
        .map(el => Number(el.id.replace('internalFeedCard_', ''))));
      assert(!page1Ids.includes(1), `trang 1 "Mới nhất" KHÔNG được chứa bài id=1 (tiền đề của lỗi) — thực tế: ${JSON.stringify(page1Ids)}`);
      assertEqual(page1Ids.length, 10, 'trang 1 phải đủ 10 bài (pageSize mặc định)');
    });

    await run('Đang ở trang 1 Nhịp Sống HCRC > mở trực tiếp viewInternalPostDetail(1) (VD từ link email, bài ghim ở trang 2) > đóng modal: PHẢI tự chuyển sang trang 2 rồi cuộn đúng vào thẻ bài id=1', async () => {
      // Đảm bảo đang ở trang 1 TRƯỚC khi mở bài (đúng tiền đề lỗi: xem feed ở trang 1, rồi có 1 nguồn
      // KHÁC — không phải tự bấm phân trang — mở thẳng 1 bài đang nằm ở trang khác).
      const pageBefore = await page.evaluate(() => getListPageState('internalNews').page);
      assertEqual(pageBefore, 1, 'tiền đề: phải đang ở trang 1');

      await page.evaluate(() => viewInternalPostDetail(1));
      await page.waitForTimeout(200);
      const modalVisible = await page.evaluate(() => !document.getElementById('internalArticleModal').classList.contains('hidden'));
      assert(modalVisible, 'modal Chi tiết phải mở ra');

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
