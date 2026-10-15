'use strict';

// tests/test-internal-feed-snippet-clamp.js — Nhịp Sống HCRC/Góc Chia Sẻ (renderInternalFeedStyle(),
// module-internalcomms-nhipsong.js).
//
// LỖI ĐÃ VÁ (11/2026, người dùng báo nội dung bài hiển thị quá dài trên thẻ feed, tràn nhiều dòng trước
// khi tới "Xem thêm" — kèm ảnh chụp thật): trước đây cắt CỨNG 300 ký tự rồi nối "Xem thêm" ngay trong
// CÙNG 1 thẻ <p> — với câu/từ dài, 300 ký tự vẫn tràn rất nhiều dòng hiển thị (cắt theo SỐ KÝ TỰ, không
// phải SỐ DÒNG). Vá: dùng "line-clamp-3" (CSS, giới hạn ĐÚNG 3 dòng hiển thị bất kể độ dài chữ) + tách
// "Xem thêm" RA NGOÀI đoạn bị line-clamp (tránh bị line-clamp's overflow:hidden cắt mất luôn nếu rơi
// đúng ranh giới dòng 3).
//
// Chạy: node tests/test-internal-feed-snippet-clamp.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8973;
const LONG_CONTENT = Array.from({ length: 20 }, (_, i) => `Câu nội dung số ${i + 1} khá dài để chắc chắn tràn quá 3 dòng hiển thị thật sự trên màn hình.`).join(' ');

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();
  try {
    const admin = makeUser({ username: 'admin1', name: 'Quản Trị Viên', perms: { admin: true } });
    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate((u) => { DB.users = [u]; }, admin);
    await page.evaluate((u) => finishLogin(u), admin);

    await page.evaluate((content) => {
      DB.internalPosts = [
        { id: 9701, type: 'NEWS', status: 'APPROVED', title: 'Bài nội dung dài', authorName: 'A', createdAt: '1/1/2026', content, likes: [], comments: [], readBy: [] },
        { id: 9702, type: 'NEWS', status: 'APPROVED', title: 'Bài nội dung ngắn', authorName: 'A', createdAt: '1/1/2026', content: 'Ngắn gọn.', likes: [], comments: [], readBy: [] }
      ];
      switchTab('internal');
      setInternalSubTab('NEWS');
    }, LONG_CONTENT);
    await page.waitForTimeout(300);

    await run('đoạn nội dung bài trên thẻ feed có class line-clamp-3 (giới hạn đúng 3 dòng, không cắt theo số ký tự nữa)', async () => {
      const info = await page.evaluate(() => {
        const card = document.getElementById('internalFeedCard_9701');
        const p = card.querySelector('p.text-sm.text-gray-700');
        return { exists: !!p, hasClamp: p ? p.className.includes('line-clamp-3') : false, text: p ? p.textContent : null };
      });
      assert(info.exists, 'phải có đoạn <p> nội dung trên thẻ feed');
      assert(info.hasClamp, 'đoạn nội dung phải có class line-clamp-3');
      assert(info.text.includes('Câu nội dung số 1'), 'nội dung đầy đủ vẫn phải nằm trong DOM (chỉ CSS ẩn bớt, không cắt chuỗi)');
    });

    await run('"Xem thêm" là phần tử RIÊNG, nằm NGOÀI đoạn bị line-clamp (không bị cắt mất khi line-clamp overflow:hidden)', async () => {
      const info = await page.evaluate(() => {
        const card = document.getElementById('internalFeedCard_9701');
        const p = card.querySelector('p.line-clamp-3');
        const moreLinks = [...card.querySelectorAll('[data-op="viewInternalPostDetail"]')]
          .filter(el => el.textContent.trim() === 'Xem thêm');
        return { moreCount: moreLinks.length, moreInsideClampedP: moreLinks.some(el => p.contains(el)) };
      });
      assert(info.moreCount >= 1, 'phải có đúng 1 (hoặc nhiều) phần tử "Xem thêm" trên thẻ');
      assert(!info.moreInsideClampedP, '"Xem thêm" KHÔNG được nằm BÊN TRONG đoạn bị line-clamp (tránh bị overflow:hidden cắt mất)');
    });

    await run('class "line-clamp-3" có rule thật trong tailwind.css đã build (không chỉ ghi trong JS)', async () => {
      const fs = require('fs');
      const path = require('path');
      const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'tailwind.css'), 'utf8');
      assert(css.includes('.line-clamp-3'), 'tailwind.css phải có rule .line-clamp-3 (cần npm run build:css nếu thiếu)');
    });

    await run('bấm "Xem thêm" vẫn mở đúng modal Chi tiết bài', async () => {
      await page.click('#internalFeedCard_9701 [data-op="viewInternalPostDetail"]');
      await page.waitForTimeout(300);
      const title = await page.evaluate(() => document.getElementById('internalArticleTitle').textContent);
      assert(title.includes('Bài nội dung dài'), 'modal phải mở đúng bài vừa bấm Xem thêm');
      await page.evaluate(() => closeInternalArticleModal());
    });

    assertEqual(pageErrors.length, 0, `unexpected page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
    summarize('test-internal-feed-snippet-clamp.js');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
