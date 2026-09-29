// tests/test-dashboard-news-thumbnail.js — Trang chủ > khung "Tin mới" (renderDashboardNews(), core-dashboard.js).
// Kiểm tra: thumbnail ảnh (coverImage/images[0]/attachment ảnh cũ) + placeholder khi không có ảnh,
// nút "Xem thêm →" nằm trong cùng khối data-op-seq (click nút mở đúng chi tiết), class hover mới có
// rule thật trong public/tailwind.css đã build tĩnh, escape tiêu đề/URL ảnh, không có on*=/style= nội tuyến.
//
// Run: node tests/test-dashboard-news-thumbnail.js
const fs = require('fs');
const path = require('path');
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser, PUBLIC_DIR } = require('./_harness');

const PORT = 8971;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();
  try {
    const admin = makeUser({ username: 'admin1', name: 'Quản Trị Viên', perms: { admin: true } });
    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((u) => { DB.users = [u]; }, admin);
    await page.evaluate((u) => finishLogin(u), admin);

    await page.evaluate(() => {
      DB.internalPosts = [
        // Bài MỚI có coverImage riêng (khác images[0]) -> thumbnail phải là coverImage
        { id: 5005, type: 'NEWS', status: 'APPROVED', title: 'Tin có ảnh đại diện', authorName: 'A', createdAt: '1/9/2026',
          images: [{ fileUrl: '/uploads/img-first.png', fileName: 'first.png' }, { fileUrl: '/uploads/img-cover.png', fileName: 'cover.png' }],
          coverImage: { fileUrl: '/uploads/img-cover.png', fileName: 'cover.png' }, likes: [], comments: [], readBy: [] },
        // Bài MỚI chỉ có images[] -> images[0]
        { id: 5004, type: 'NEWS', status: 'APPROVED', title: 'Tin chỉ có images', authorName: 'A', createdAt: '1/9/2026',
          images: [{ fileUrl: '/uploads/img-only.png', fileName: 'only.png' }], likes: [], comments: [], readBy: [] },
        // Bài CŨ: attachment ảnh -> dùng attachment.fileUrl
        { id: 5003, type: 'NEWS', status: 'APPROVED', title: 'Tin cũ ảnh bìa', authorName: 'B', createdAt: '1/8/2026',
          attachment: { fileName: 'old.jpg', fileType: 'image/jpeg', fileUrl: '/uploads/old.jpg' }, likes: [], comments: [], readBy: [] },
        // Bài CŨ: attachment PDF -> placeholder, KHÔNG dùng PDF làm ảnh
        { id: 5002, type: 'NEWS', status: 'APPROVED', title: 'Tin cũ PDF <b>x</b>', authorName: 'B', createdAt: '1/7/2026',
          attachment: { fileName: 'a.pdf', fileType: 'application/pdf', fileUrl: '/uploads/a.pdf' }, likes: [], comments: [], readBy: [] },
        // Không có gì -> placeholder
        { id: 5001, type: 'NEWS', status: 'APPROVED', title: 'Tin không ảnh', authorName: 'C', createdAt: '1/6/2026', likes: [], comments: [], readBy: [] }
      ];
      switchTab('dashboard');
      renderDashboardNews();
    });

    await run('mỗi box có thumbnail đúng nguồn ưu tiên (coverImage > images[0] > attachment ảnh cũ) hoặc placeholder', async () => {
      const info = await page.evaluate(() => [...document.querySelectorAll('#dashboardNewsContainer .dash-news-card')].map(card => {
        const t = card.querySelector('.dash-news-thumb');
        return { tag: t.tagName, src: t.getAttribute('src'), placeholder: t.classList.contains('dash-news-thumb-placeholder') };
      }));
      assertEqual(info.length, 5, 'phải có 5 box tin');
      assertEqual(info[0].src, '/uploads/img-cover.png', 'bài có coverImage phải dùng coverImage');
      assertEqual(info[1].src, '/uploads/img-only.png', 'bài chỉ có images[] phải dùng images[0]');
      assertEqual(info[2].src, '/uploads/old.jpg', 'bài cũ attachment ảnh phải dùng attachment.fileUrl');
      assert(info[3].placeholder && info[3].tag === 'DIV', 'bài cũ attachment PDF phải hiện placeholder');
      assert(info[4].placeholder && info[4].tag === 'DIV', 'bài không ảnh phải hiện placeholder');
    });

    await run('tiêu đề được escape (không chèn thẻ HTML thô)', async () => {
      const html = await page.evaluate(() => document.getElementById('dashboardNewsContainer').innerHTML);
      assert(html.includes('Tin cũ PDF &lt;b&gt;x&lt;/b&gt;'), 'tiêu đề phải được escapeHtml');
    });

    await run('mỗi box có nút "Xem thêm →" nằm BÊN TRONG khối data-op-seq', async () => {
      const ok = await page.evaluate(() => [...document.querySelectorAll('#dashboardNewsContainer .dash-news-card')]
        .every(card => { const m = card.querySelector('.dash-news-more'); return m && m.textContent.includes('Xem thêm') && m.closest('[data-op-seq]') === card; }));
      assert(ok, 'mỗi box phải có .dash-news-more nằm trong đúng box');
    });

    await run('click riêng nút "Xem thêm →" mở đúng chi tiết bài', async () => {
      await page.evaluate(() => { window.__viewed = []; const orig = window.viewInternalPostDetail; window.viewInternalPostDetail = (id) => { window.__viewed.push(id); try { orig(id); } catch (_) {} }; });
      await page.click('#dashboardNewsContainer .dash-news-card:nth-child(3) .dash-news-more');
      await page.waitForTimeout(300);
      const viewed = await page.evaluate(() => window.__viewed.slice());
      assertEqual(viewed[viewed.length - 1], 5003, 'click "Xem thêm" phải gọi viewInternalPostDetail(5003)');
    });

    await run('class hover mới (nền/viền fuchsia) có rule thật trong tailwind.css đã build', async () => {
      const css = fs.readFileSync(path.join(PUBLIC_DIR, 'tailwind.css'), 'utf8');
      ['.hover\\:bg-fuchsia-50:hover', '.hover\\:border-fuchsia-300:hover', '.group:hover .group-hover\\:underline', '.object-cover', '.w-14', '.h-14']
        .forEach(sel => assert(css.includes(sel), `tailwind.css thiếu rule ${sel}`));
      const cls = await page.evaluate(() => document.querySelector('#dashboardNewsContainer .dash-news-card').className);
      assert(cls.includes('hover:bg-fuchsia-50') && cls.includes('hover:border-fuchsia-300'), 'box phải có class hover mới');
    });

    await run('không có on*=/style= nội tuyến trong HTML trang chủ tin tức', async () => {
      const html = await page.evaluate(() => document.getElementById('dashboardNewsContainer').innerHTML);
      assert(!/\son[a-z]+="/i.test(html), 'không được có on*= nội tuyến');
      assert(!/\sstyle="/i.test(html), 'không được có style= nội tuyến');
    });

    assertEqual(pageErrors.length, 0, `unexpected page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
    summarize('test-dashboard-news-thumbnail.js');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
