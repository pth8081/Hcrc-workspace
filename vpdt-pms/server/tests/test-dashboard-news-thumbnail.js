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
        // Bài MỚI có coverImage riêng (khác images[0]) -> thumbnail phải là coverImage. Có content ->
        // dùng để kiểm tra đoạn "sapo" trích ngắn (11/2026).
        { id: 5005, type: 'NEWS', status: 'APPROVED', title: 'Tin có ảnh đại diện', authorName: 'A', createdAt: '1/9/2026',
          images: [{ fileUrl: '/uploads/img-first.png', fileName: 'first.png' }, { fileUrl: '/uploads/img-cover.png', fileName: 'cover.png' }],
          coverImage: { fileUrl: '/uploads/img-cover.png', fileName: 'cover.png' },
          content: 'Đây là nội dung đầy đủ của bài đăng dùng để kiểm tra đoạn trích sapo hiển thị trên thẻ Trang chủ.',
          likes: [], comments: [], readBy: [] },
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
      ['.hover\\:bg-fuchsia-50:hover', '.hover\\:border-fuchsia-300:hover', '.group:hover .group-hover\\:underline', '.object-cover',
        // Kích thước thumbnail responsive (11/2026, vá lỗi "chữ bị vỡ dòng trên mobile" do cỡ cố định
        // 336px trước đó — xem chú thích tại renderDashboardNews()/core-dashboard.js): w-16/h-16 (mobile)
        // -> sm:w-20/sm:h-20 -> md:w-24/md:h-24 (desktop), cùng line-clamp-2 cho đoạn sapo mới.
        '.w-16', '.h-16', '.sm\\:w-20', '.sm\\:h-20', '.md\\:w-24', '.md\\:h-24', '.line-clamp-2']
        .forEach(sel => assert(css.includes(sel), `tailwind.css thiếu rule ${sel}`));
      const cls = await page.evaluate(() => document.querySelector('#dashboardNewsContainer .dash-news-card').className);
      assert(cls.includes('hover:bg-fuchsia-50') && cls.includes('hover:border-fuchsia-300'), 'box phải có class hover mới');
    });

    await run('không có on*=/style= nội tuyến trong HTML trang chủ tin tức', async () => {
      const html = await page.evaluate(() => document.getElementById('dashboardNewsContainer').innerHTML);
      assert(!/\son[a-z]+="/i.test(html), 'không được có on*= nội tuyến');
      assert(!/\sstyle="/i.test(html), 'không được có style= nội tuyến');
    });

    // LỖI ĐÃ VÁ (11/2026, người dùng báo ảnh chụp thật "chữ bị bẻ dọc từng ký tự" trên điện thoại hẹp):
    // thumbnail cỡ cố định 336px (w-[336px]/h-[336px], flex-shrink-0) chiếm gần hết chiều ngang card trên
    // màn hình nhỏ, đẩy cột chữ bên cạnh (dù có min-w-0 flex-1) co về gần 0 -> chữ tràn dòng ký tự. Vá:
    // thumbnail co giãn thật theo breakpoint (w-16 mobile -> sm:w-20 -> md:w-24 desktop), KHÔNG còn 1 cỡ
    // cố định duy nhất cho mọi màn hình.
    await run('thumbnail dùng cỡ co giãn theo breakpoint (w-16/sm:w-20/md:w-24), KHÔNG còn cỡ cố định 336px gây vỡ chữ trên mobile', async () => {
      const cls = await page.evaluate(() => document.querySelector('#dashboardNewsContainer .dash-news-thumb').className);
      assert(cls.includes('w-16') && cls.includes('h-16'), 'thumbnail phải có cỡ cơ bản w-16/h-16 (mobile)');
      assert(cls.includes('sm:w-20') && cls.includes('md:w-24'), 'thumbnail phải co giãn lớn dần theo breakpoint sm/md');
      assert(!cls.includes('w-[336px]') && !cls.includes('h-[336px]'), 'KHÔNG được còn cỡ cố định 336px cũ (gây vỡ chữ trên mobile hẹp)');
    });

    // "Sapo" (11/2026, theo yêu cầu người dùng "mỗi trang tin hiện vài dòng sapo") — đoạn trích ngắn nội
    // dung bài, giới hạn hiển thị bằng line-clamp-2 (CSS, không tự cắt số ký tự cho khớp 100% số dòng).
    await run('bài có content hiện đoạn sapo trích ngắn (line-clamp-2); bài không có content thì không hiện gì', async () => {
      const info = await page.evaluate(() => [...document.querySelectorAll('#dashboardNewsContainer .dash-news-card')].map(card => {
        const p = card.querySelector('p.line-clamp-2');
        return p ? p.textContent : null;
      }));
      assert(info[0] && info[0].includes('kiểm tra đoạn trích sapo'), 'bài có content phải hiện đoạn sapo đúng nội dung');
      assert(info[4] === null, 'bài không có content (Tin không ảnh) không được hiện đoạn <p> sapo nào');
    });

    // Bố cục khung Tin Tức Nổi Bật ở Trang chủ (11/2026) — GIỮ NGUYÊN lưới 2 cột (md:grid-cols-2), KHÔNG
    // bọc max-width hẹp kiểu Facebook ở đây (người dùng xác nhận lại sau khi xem demo: bố cục 1 cột hẹp
    // kiểu Facebook chỉ áp dụng ở tab Nhịp Sống HCRC/Góc Chia Sẻ thật — xem
    // test-internal-share-feed-style.js/internalSection.html — Trang chủ chỉ là khung xem nhanh/widget
    // dashboard, giữ 2 cột cho gọn, không cuộn quá dài).
    await run('khung Tin Tức Nổi Bật ở Trang chủ GIỮ lưới 2 cột (md:grid-cols-2), KHÔNG bọc max-width hẹp (khác tab Nhịp Sống HCRC thật)', async () => {
      const classes = await page.evaluate(() => ({
        section: document.getElementById('dashboardNewsSection').className,
        container: document.getElementById('dashboardNewsContainer').className
      }));
      assert(!classes.section.includes('max-w-2xl'), 'dashboardNewsSection KHÔNG được bọc max-w-2xl (chỉ áp dụng ở tab Nhịp Sống HCRC thật, không phải Trang chủ)');
      assert(classes.container.includes('grid-cols-1') && classes.container.includes('md:grid-cols-2'), 'dashboardNewsContainer phải giữ lưới grid-cols-1 md:grid-cols-2 (1 cột mobile, 2 cột desktop)');
    });

    assertEqual(pageErrors.length, 0, `unexpected page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
    summarize('test-dashboard-news-thumbnail.js');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
