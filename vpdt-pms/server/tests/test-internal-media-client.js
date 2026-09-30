// tests/test-internal-media-client.js — Nhịp Sống HCRC/Góc Chia Sẻ (9/2026), phía CLIENT:
//  - chọn NHIỀU ảnh 1 lần (#internalImagesInput multiple) -> mỗi ảnh gọi /api/upload riêng (moduleKey
//    internalImage), bấm chọn ảnh đại diện, trần 8 ảnh; video -> làn '/api/upload?module=internalVideo'.
//  - khung soạn thảo contenteditable (Bold + Danh sách) -> payload contentFormat 'html'.
//  - hiển thị: badge chuyên đề (thẻ feed + chi tiết), dropdown lọc chuyên đề, thư viện ảnh + video ở chi
//    tiết, DOMPurify lọc lớp 2 (onerror/script không lọt vào DOM), bài CŨ hiển thị y như trước.
//
// Run: node tests/test-internal-media-client.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

const PORT = 8973;
const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000000', 'hex');
const MP4 = (() => { const b = Buffer.alloc(64); b.writeUInt32BE(32, 0); b.write('ftyp', 4); b.write('isom', 8); return b; })();

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();
  try {
    const admin = makeUser({ username: 'admin1', name: 'Quản Trị Viên', dept: 'Phòng CNTT', perms: { admin: true } });
    await page.evaluate((seed) => {
      Object.assign(DB, seed);
      DB.internalNewsCategories = [{ key: 'HOAT_DONG_CHUNG', label: 'Hoạt động chung' }, { key: 'VAN_HOA', label: 'Văn hoá doanh nghiệp' }];
    }, baseCatalogSeed());
    await page.evaluate((u) => { DB.users = [u]; }, admin);
    await page.evaluate((u) => finishLogin(u), admin);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('NEWS'); });

    const waitUploads = (expectImages, expectVideos) => page.waitForFunction(([i, v]) =>
      internalMediaUploading === 0 && internalMediaDraft.images.length === i && internalMediaDraft.videos.length === v, [expectImages, expectVideos], { timeout: 10000 });

    await run('#internalContent là khung contenteditable có toolbar Bold + Danh sách (không còn textarea)', async () => {
      const info = await page.evaluate(() => {
        const ed = document.getElementById('internalContent');
        return { tag: ed.tagName, editable: ed.getAttribute('contenteditable'), btns: [...document.querySelectorAll('[data-op="internalEditorExec"]')].map(b => b.dataset.arg0) };
      });
      assertEqual(info.tag, 'DIV', 'internalContent phải là DIV');
      assertEqual(info.editable, 'true', 'phải contenteditable');
      assert(info.btns.includes('bold') && info.btns.includes('insertUnorderedList'), `thiếu nút toolbar: ${JSON.stringify(info.btns)}`);
    });

    await run('Bold + Danh sách qua execCommand sinh đúng <b>/<ul><li>', async () => {
      await page.click('#internalContent');
      await page.keyboard.type('Chữ đậm');
      await page.keyboard.press('Control+A');
      await page.click('[data-op="internalEditorExec"][data-arg0="bold"]');
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.click('[data-op="internalEditorExec"][data-arg0="insertUnorderedList"]');
      await page.keyboard.type('mục 1');
      const html = await page.evaluate(() => document.getElementById('internalContent').innerHTML);
      assert(/<b>Chữ đậm<\/b>/.test(html), `phải có <b>: ${html}`);
      assert(/<ul><li>(<b>)?mục 1/.test(html), `phải có danh sách: ${html}`);
    });

    await run('chọn 3 ảnh 1 lần -> 3 lượt /api/upload moduleKey internalImage, ảnh đầu mặc định là đại diện', async () => {
      await page.evaluate(() => { window.__uploadModuleKeys = []; window.__uploadUrls = []; });
      await page.setInputFiles('#internalImagesInput', [1, 2, 3].map(n => ({ name: `anh${n}.png`, mimeType: 'image/png', buffer: PNG })));
      await waitUploads(3, 0);
      const keys = await page.evaluate(() => window.__uploadModuleKeys.slice());
      assertEqual(keys.filter(k => k === 'internalImage').length, 3, `phải có 3 lượt upload internalImage: ${JSON.stringify(keys)}`);
      const badges = await page.evaluate(() => [...document.querySelectorAll('#internalImagesPreview .internal-draft-image')].map(d => !!d.querySelector('.internal-draft-cover-badge')));
      assertEqual(JSON.stringify(badges), JSON.stringify([true, false, false]), 'ảnh đầu mặc định là đại diện');
    });

    await run('bấm ảnh thứ 3 -> chọn làm ảnh đại diện', async () => {
      await page.click('#internalImagesPreview .internal-draft-image:nth-child(3) img');
      const badges = await page.evaluate(() => [...document.querySelectorAll('#internalImagesPreview .internal-draft-image')].map(d => !!d.querySelector('.internal-draft-cover-badge')));
      assertEqual(JSON.stringify(badges), JSON.stringify([false, false, true]), 'ảnh 3 phải là đại diện');
    });

    await run('thêm lần 2 vượt trần: đang 3 ảnh, chọn thêm 7 -> chỉ nhận thêm 5 (tổng 8) + cảnh báo', async () => {
      await page.evaluate(() => { window.__alerts.length = 0; });
      await page.setInputFiles('#internalImagesInput', [4, 5, 6, 7, 8, 9, 10].map(n => ({ name: `anh${n}.png`, mimeType: 'image/png', buffer: PNG })));
      await waitUploads(8, 0);
      const alerts = await page.evaluate(() => window.__alerts.slice());
      assert(alerts.some(a => a.includes('tối đa 8')), `phải cảnh báo trần 8 ảnh: ${JSON.stringify(alerts)}`);
    });

    await run('bỏ bớt 1 ảnh (×) còn 7', async () => {
      await page.click('#internalImagesPreview .internal-draft-image:nth-child(8) button');
      assertEqual(await page.evaluate(() => internalMediaDraft.images.length), 7, 'còn 7 ảnh');
    });

    await run('video -> gọi làn /api/upload?module=internalVideo với moduleKey internalVideo', async () => {
      await page.evaluate(() => { window.__uploadModuleKeys = []; window.__uploadUrls = []; });
      await page.setInputFiles('#internalVideosInput', [{ name: 'clip.mp4', mimeType: 'video/mp4', buffer: MP4 }]);
      await waitUploads(7, 1);
      const r = await page.evaluate(() => ({ keys: window.__uploadModuleKeys.slice(), urls: window.__uploadUrls.slice() }));
      assertEqual(r.keys[0], 'internalVideo', 'moduleKey video');
      assertEqual(r.urls[0], '/api/upload?module=internalVideo', 'URL làn video');
    });

    await run('video sai đuôi (.avi) bị chặn ngay ở client, không gọi upload', async () => {
      await page.evaluate(() => { window.__uploadModuleKeys = []; });
      await page.setInputFiles('#internalVideosInput', [{ name: 'clip.avi', mimeType: 'video/x-msvideo', buffer: MP4 }]);
      await page.waitForTimeout(200);
      const r = await page.evaluate(() => ({ keys: window.__uploadModuleKeys.slice(), status: document.getElementById('internalVideosStatus').textContent, n: internalMediaDraft.videos.length }));
      assertEqual(r.keys.length, 0, 'không được gọi upload');
      assertEqual(r.n, 1, 'vẫn 1 video');
      assert(r.status.includes('.mp4/.webm'), `phải báo lỗi định dạng: ${r.status}`);
    });

    let newId;
    await run('Đăng bài -> payload có contentFormat html + images(7) + coverImage (ảnh đã chọn) + videos(1)', async () => {
      await page.evaluate(() => {
        document.getElementById('internalTitle').value = 'Bài có ảnh + video';
        document.getElementById('internalPostCategory').value = 'VAN_HOA';
        window.__alerts.length = 0;
      });
      await page.evaluate(() => submitInternalPost({ preventDefault() {}, submitter: null }));
      const p = await page.evaluate(() => DB.internalPosts.find(x => x.title === 'Bài có ảnh + video'));
      assert(p, 'bài phải được tạo');
      newId = p.id;
      assertEqual(p.contentFormat, 'html', 'contentFormat');
      assertEqual(p.images.length, 7, 'số ảnh');
      assertEqual(p.coverImage.fileName, 'anh3.png', 'ảnh đại diện phải là ảnh 3 đã chọn');
      assertEqual(p.videos.length, 1, 'số video');
      assert(/<b>Chữ đậm<\/b>/.test(p.content), `content HTML: ${p.content}`);
      assert(!p.attachment, 'attachment cũ không được dùng cho ảnh');
      const draftAfter = await page.evaluate(() => ({ imgs: internalMediaDraft.images.length, html: document.getElementById('internalContent').innerHTML }));
      assertEqual(draftAfter.imgs, 0, 'bản nháp ảnh phải được dọn sau khi đăng');
      assertEqual(draftAfter.html, '', 'khung soạn thảo phải trống sau khi đăng');
    });

    await run('thẻ feed: ảnh bìa = ảnh đại diện, nhãn đếm ảnh/video, badge chuyên đề, snippet chữ thuần', async () => {
      const info = await page.evaluate(() => {
        const html = document.getElementById('internalPostsContainer').innerHTML;
        const p = DB.internalPosts.find(x => x.title === 'Bài có ảnh + video');
        return { html, cover: p.coverImage.fileUrl };
      });
      assert(info.html.includes(`src="${info.cover}"`), 'thẻ feed phải dùng ảnh đại diện');
      assert(info.html.includes('🖼️ 7') && info.html.includes('🎬 1'), 'phải có nhãn đếm ảnh/video');
      assert(info.html.includes('🏷️ Văn hoá doanh nghiệp'), 'phải có badge chuyên đề');
      assert(!info.html.includes('&lt;b&gt;'), 'snippet không được lộ thẻ HTML dạng chữ');
    });

    await run('chi tiết bài MỚI: thư viện ảnh (ảnh đại diện đứng đầu, 7 thumbnail, nút ‹ ›), video, nội dung HTML đã lọc', async () => {
      await page.evaluate((id) => viewInternalPostDetail(id), newId);
      await page.waitForFunction(() => document.querySelector('#internalArticleContent .internal-rich-body')?.innerHTML.length > 0);
      const info = await page.evaluate(() => {
        const root = document.getElementById('internalArticleContent');
        return {
          main: root.querySelector('.internal-gallery-main')?.getAttribute('src'),
          mainClass: root.querySelector('.internal-gallery-main')?.className,
          thumbs: root.querySelectorAll('.internal-gallery-thumb').length,
          hasNav: !!root.querySelector('.internal-gallery-next'),
          videos: root.querySelectorAll('video').length,
          body: root.querySelector('.internal-rich-body').innerHTML,
          badge: root.innerHTML.includes('🏷️ Văn hoá doanh nghiệp')
        };
      });
      const cover = await page.evaluate((id) => DB.internalPosts.find(x => x.id === id).coverImage.fileUrl, newId);
      assertEqual(info.main, cover, 'ảnh lớn đầu tiên phải là ảnh đại diện');
      assert(info.mainClass.includes('object-contain'), 'ảnh lớn không cắt méo (object-contain)');
      assertEqual(info.thumbs, 7, 'số thumbnail');
      assert(info.hasNav, 'phải có nút chuyển ảnh');
      assertEqual(info.videos, 1, 'phải có 1 video');
      assert(/<b>Chữ đậm<\/b>/.test(info.body) && /<ul>/.test(info.body), `nội dung HTML: ${info.body}`);
      assert(info.badge, 'chi tiết phải có badge chuyên đề');
    });

    await run('carousel: bấm › chuyển sang ảnh 2, bấm thumbnail 5 nhảy tới ảnh 5, ‹ từ ảnh 1 vòng về ảnh cuối', async () => {
      await page.click('#internalArticleContent .internal-gallery-next');
      let s = await page.evaluate(() => ({ idx: document.querySelector('#internalArticleContent .internal-gallery').dataset.galleryIdx, counter: document.querySelector('#internalArticleContent .internal-gallery-counter').textContent }));
      assertEqual(s.idx, '1', 'idx sau ›'); assertEqual(s.counter, '2/7', 'bộ đếm');
      await page.click('#internalArticleContent .internal-gallery-thumb:nth-child(5)');
      s = await page.evaluate(() => document.querySelector('#internalArticleContent .internal-gallery').dataset.galleryIdx);
      assertEqual(s, '4', 'idx sau bấm thumbnail 5');
      await page.evaluate((id) => showInternalGalleryImage(id, 0), newId);
      await page.click('#internalArticleContent .internal-gallery-prev');
      s = await page.evaluate(() => document.querySelector('#internalArticleContent .internal-gallery').dataset.galleryIdx);
      assertEqual(s, '6', '‹ từ ảnh đầu phải vòng về ảnh cuối');
      await page.evaluate(() => closeInternalArticleModal());
    });

    await run('DOMPurify lớp 2: HTML độc (onerror/script) lỡ có trong dữ liệu không lọt vào DOM khi hiển thị', async () => {
      await page.evaluate(() => {
        window.__xss = 0;
        DB.internalPosts.unshift({ id: 990001, type: 'NEWS', status: 'APPROVED', title: 'XSS test', authorName: 'X', dept: 'D', createdAt: '1/9/2026', code: 'TN-1',
          contentFormat: 'html', content: '<p>an toàn</p><img src=x onerror="window.__xss=1"><script>window.__xss=2</script><a href="javascript:window.__xss=3">x</a>',
          postCategory: 'HOAT_DONG_CHUNG', likes: [], comments: [], readBy: [] });
      });
      await page.evaluate(() => viewInternalPostDetail(990001));
      await page.waitForFunction(() => document.querySelector('#internalArticleContent .internal-rich-body')?.innerHTML.length > 0);
      await page.waitForTimeout(200);
      const r = await page.evaluate(() => ({ body: document.querySelector('#internalArticleContent .internal-rich-body').innerHTML, xss: window.__xss }));
      assert(!/<img|onerror|<script|javascript:|<a\b/i.test(r.body), `còn nội dung nguy hiểm: ${r.body}`);
      assert(r.body.includes('<p>an toàn</p>'), 'giữ phần hợp lệ');
      assertEqual(r.xss, 0, 'không đoạn mã nào được chạy');
      await page.evaluate(() => { closeInternalArticleModal(); DB.internalPosts = DB.internalPosts.filter(p => p.id !== 990001); });
    });

    await run('tương thích ngược: bài CŨ (không contentFormat/images) hiển thị y như trước (escape + pre-wrap + 1 ảnh bìa từ attachment)', async () => {
      await page.evaluate(() => {
        DB.internalPosts.push({ id: 990002, type: 'NEWS', status: 'APPROVED', title: 'Bài cũ', authorName: 'Y', dept: 'D', createdAt: '1/1/2026', code: 'TN-2',
          content: 'Dòng 1 <b>không đậm</b>\nDòng 2', attachment: { fileName: 'old.jpg', fileType: 'image/jpeg', fileUrl: '/uploads/old-cover.jpg' },
          likes: [], comments: [], readBy: [] });
      });
      await page.evaluate(() => viewInternalPostDetail(990002));
      const r = await page.evaluate(() => {
        const root = document.getElementById('internalArticleContent');
        const pre = root.querySelector('.whitespace-pre-wrap');
        return { pre: pre && pre.innerHTML, gallery: !!root.querySelector('.internal-gallery'), rich: !!root.querySelector('.internal-rich-body'),
          cover: root.querySelector('img.object-cover')?.getAttribute('src') };
      });
      assertEqual(r.pre, 'Dòng 1 &lt;b&gt;không đậm&lt;/b&gt;\nDòng 2', 'bài cũ phải escapeHtml + pre-wrap');
      assert(!r.gallery && !r.rich, 'bài cũ KHÔNG có gallery/rich body');
      assertEqual(r.cover, '/uploads/old-cover.jpg', 'bài cũ giữ 1 ảnh bìa từ attachment');
      await page.evaluate(() => closeInternalArticleModal());
      const cardHtml = await page.evaluate(() => { renderInternalPosts(); return document.getElementById('internalPostsContainer').innerHTML; });
      assert(cardHtml.includes('src="/uploads/old-cover.jpg"'), 'thẻ feed bài cũ vẫn dùng attachment làm ảnh bìa');
      assert(cardHtml.includes('Dòng 1 &lt;b&gt;không đậm&lt;/b&gt;'), 'snippet bài cũ vẫn escape như trước');
    });

    await run('dropdown lọc chuyên đề: có đủ chuyên đề NEWS, lọc VAN_HOA chỉ còn bài VAN_HOA', async () => {
      const opts = await page.evaluate(() => [...document.querySelectorAll('#filterCategoryInternal option')].map(o => o.value));
      assertEqual(JSON.stringify(opts), JSON.stringify(['', 'HOAT_DONG_CHUNG', 'VAN_HOA']), 'danh sách lựa chọn');
      const visibleWrap = await page.evaluate(() => !document.getElementById('internalCategoryFilterWrap').classList.contains('hidden'));
      assert(visibleWrap, 'ô lọc chuyên đề phải hiện ở tab NEWS');
      await page.selectOption('#filterCategoryInternal', 'VAN_HOA');
      const html = await page.evaluate(() => document.getElementById('internalPostsContainer').innerHTML);
      assert(html.includes('Bài có ảnh + video') && !html.includes('Bài cũ'), 'chỉ còn bài chuyên đề VAN_HOA');
      await page.selectOption('#filterCategoryInternal', '');
    });

    await run('sửa bài nháp: nạp lại nội dung HTML + ảnh/đại diện/video vào form', async () => {
      await page.evaluate(() => {
        DB.internalPosts.push({ id: 990003, type: 'NEWS', status: 'DRAFT', author: 'admin1', title: 'Nháp', authorName: 'A', dept: 'D', createdAt: '1/1/2026', code: 'TN-3',
          contentFormat: 'html', content: '<p><b>đậm</b></p>', postCategory: 'HOAT_DONG_CHUNG',
          images: [{ fileUrl: '/uploads/n1.png', fileName: 'n1.png' }, { fileUrl: '/uploads/n2.png', fileName: 'n2.png' }],
          coverImage: { fileUrl: '/uploads/n2.png', fileName: 'n2.png' }, videos: [{ fileUrl: '/uploads/n.mp4', fileName: 'n.mp4' }], likes: [], comments: [], readBy: [] });
      });
      await page.evaluate(() => editInternalPostUI(990003));
      await page.waitForFunction(() => document.getElementById('internalContent').innerHTML.includes('<b>đậm</b>'));
      const d = await page.evaluate(() => ({ imgs: internalMediaDraft.images.length, cover: internalMediaDraft.coverUrl, vids: internalMediaDraft.videos.length }));
      assertEqual(d.imgs, 2, 'ảnh'); assertEqual(d.cover, '/uploads/n2.png', 'đại diện'); assertEqual(d.vids, 1, 'video');
      await page.evaluate(() => cancelEditInternalPost());
      const after = await page.evaluate(() => ({ imgs: internalMediaDraft.images.length, html: document.getElementById('internalContent').innerHTML }));
      assertEqual(after.imgs, 0, 'Huỷ Sửa phải dọn bản nháp ảnh'); assertEqual(after.html, '', 'Huỷ Sửa phải dọn khung soạn thảo');
    });

    // ===== Video nhúng YouTube (9/2026) — {type:'youtube', youtubeUrl} song song video tải lên =====
    const YT_URL = 'https://youtu.be/dQw4w9WgXcQ';
    await run('YouTube: nút "Dán link YouTube" (data-op) hiện ô nhập link + ẩn ô chọn tệp; "Tải video lên" đổi lại', async () => {
      await page.click('#internalVideoModeTabs [data-video-mode="youtube"]');
      let s = await page.evaluate(() => ({ up: document.getElementById('internalVideoUploadBox').classList.contains('hidden'), yt: document.getElementById('internalVideoYoutubeBox').classList.contains('hidden') }));
      assert(s.up && !s.yt, `chế độ YouTube: ${JSON.stringify(s)}`);
      await page.click('#internalVideoModeTabs [data-video-mode="upload"]');
      s = await page.evaluate(() => ({ up: document.getElementById('internalVideoUploadBox').classList.contains('hidden'), yt: document.getElementById('internalVideoYoutubeBox').classList.contains('hidden') }));
      assert(!s.up && s.yt, `chế độ tải lên: ${JSON.stringify(s)}`);
    });

    await run('YouTube: link không hợp lệ (http/tên miền lạ/không có videoId) bị chặn ở client, không thêm vào bản nháp', async () => {
      await page.click('#internalVideoModeTabs [data-video-mode="youtube"]');
      for (const bad of ['http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.tld/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/channel/abc', 'javascript:alert(1)']) {
        await page.evaluate(() => { window.__alerts.length = 0; });
        await page.fill('#internalYoutubeUrlInput', bad);
        await page.click('[data-op="addInternalYoutubeVideo"]');
        const r = await page.evaluate(() => ({ alerts: window.__alerts.slice(), n: internalMediaDraft.videos.length }));
        assertEqual(r.n, 0, `không được thêm ${bad}`);
        assert(r.alerts.some(a => a.includes('Link YouTube không hợp lệ')), `phải báo lỗi rõ ràng cho ${bad}: ${JSON.stringify(r.alerts)}`);
      }
      await page.fill('#internalYoutubeUrlInput', '');
    });

    await run('YouTube: Enter trong ô link = Thêm (không đăng bài); + 1 video tải lên = 2; thêm thứ 3 (YouTube/tệp) bị chặn', async () => {
      const before = await page.evaluate(() => DB.internalPosts.length);
      await page.fill('#internalYoutubeUrlInput', YT_URL);
      await page.press('#internalYoutubeUrlInput', 'Enter');
      await page.waitForFunction(() => internalMediaDraft.videos.length === 1);
      const r1 = await page.evaluate(() => ({ n: DB.internalPosts.length, v: internalMediaDraft.videos.slice(), input: document.getElementById('internalYoutubeUrlInput').value,
        rows: [...document.querySelectorAll('#internalVideosPreview .internal-draft-video')].map(d => d.dataset.videoType) }));
      assertEqual(r1.n, before, 'Enter trong ô link YouTube không được đăng bài');
      assertEqual(JSON.stringify(r1.v), JSON.stringify([{ type: 'youtube', youtubeUrl: YT_URL }]), 'bản nháp YouTube');
      assertEqual(r1.input, '', 'ô link được dọn sau khi thêm');
      assertEqual(JSON.stringify(r1.rows), JSON.stringify(['youtube']), 'preview hiện dòng YouTube');
      await page.click('#internalVideoModeTabs [data-video-mode="upload"]');
      await page.setInputFiles('#internalVideosInput', [{ name: 'kem.mp4', mimeType: 'video/mp4', buffer: MP4 }]);
      await waitUploads(0, 2);
      await page.evaluate(() => { window.__alerts.length = 0; window.__uploadModuleKeys = []; });
      await page.click('#internalVideoModeTabs [data-video-mode="youtube"]');
      await page.fill('#internalYoutubeUrlInput', 'https://www.youtube.com/watch?v=abcDEF12345');
      await page.click('[data-op="addInternalYoutubeVideo"]');
      await page.click('#internalVideoModeTabs [data-video-mode="upload"]');
      await page.setInputFiles('#internalVideosInput', [{ name: 'thu3.mp4', mimeType: 'video/mp4', buffer: MP4 }]);
      await page.waitForTimeout(200);
      const r2 = await page.evaluate(() => ({ n: internalMediaDraft.videos.length, alerts: window.__alerts.slice(), keys: window.__uploadModuleKeys.slice() }));
      assertEqual(r2.n, 2, 'vẫn đúng 2 video (trần gộp)');
      assertEqual(r2.alerts.filter(a => a.includes('tối đa 2')).length, 2, `phải cảnh báo trần 2 cho cả YouTube lẫn tệp: ${JSON.stringify(r2.alerts)}`);
      assertEqual(r2.keys.length, 0, 'không được tải tệp thứ 3 lên');
      await page.evaluate(() => { document.getElementById('internalYoutubeUrlInput').value = ''; });
    });

    let ytPostId;
    await run('YouTube: đăng bài -> videos[] đúng 2 dạng {type:youtube,youtubeUrl} + {type:upload,fileUrl,fileName}', async () => {
      await page.evaluate(() => {
        document.activeElement && document.activeElement.blur();
        document.getElementById('internalTitle').value = 'Bài có YouTube';
        document.getElementById('internalPostCategory').value = 'HOAT_DONG_CHUNG';
        document.getElementById('internalContent').innerHTML = '<p>Xem video</p>';
        window.__alerts.length = 0;
      });
      await page.evaluate(() => submitInternalPost({ preventDefault() {}, submitter: null }));
      const p = await page.evaluate(() => DB.internalPosts.find(x => x.title === 'Bài có YouTube'));
      assert(p, `bài phải được tạo: ${JSON.stringify(await page.evaluate(() => window.__alerts))}`);
      ytPostId = p.id;
      assertEqual(p.videos.length, 2, 'số video');
      assertEqual(JSON.stringify(p.videos[0]), JSON.stringify({ type: 'youtube', youtubeUrl: YT_URL }), 'video YouTube');
      assertEqual(p.videos[1].type, 'upload', 'video tải lên có type upload');
      assert(/^\/uploads\//.test(p.videos[1].fileUrl) && p.videos[1].fileName, `video tải lên giữ fileUrl/fileName: ${JSON.stringify(p.videos[1])}`);
    });

    await run('YouTube: chi tiết bài hiện <iframe> nhúng youtube.com/embed/<id> (referrerpolicy, allowfullscreen) + <video> tệp tải lên', async () => {
      await page.evaluate((id) => viewInternalPostDetail(id), ytPostId);
      await page.waitForFunction(() => !!document.querySelector('#internalArticleContent .internal-videos'));
      const r = await page.evaluate(() => {
        const root = document.querySelector('#internalArticleContent .internal-videos');
        const f = root.querySelector('iframe');
        return { iframes: root.querySelectorAll('iframe').length, videos: root.querySelectorAll('video').length, src: f && f.getAttribute('src'),
          ref: f && f.getAttribute('referrerpolicy'), fs: f && f.hasAttribute('allowfullscreen'), html: root.innerHTML };
      });
      assertEqual(r.iframes, 1, 'số iframe'); assertEqual(r.videos, 1, 'số video tệp');
      assertEqual(r.src, 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'embed URL');
      assertEqual(r.ref, 'strict-origin-when-cross-origin', 'referrerpolicy');
      assert(r.fs, 'allowfullscreen');
      assert(!/\son[a-z]+="/i.test(r.html) && !/\sstyle="/i.test(r.html), `không inline handler/style: ${r.html}`);
      await page.evaluate(() => closeInternalArticleModal());
    });

    await run('YouTube: link lưu trong dữ liệu có ký tự HTML/scheme lạ không lọt vào DOM (escape + chỉ nhúng videoId hợp lệ)', async () => {
      await page.evaluate(() => {
        DB.internalPosts.push({ id: 990004, type: 'NEWS', status: 'APPROVED', title: 'YT xấu', authorName: 'Z', dept: 'D', createdAt: '1/1/2026', code: 'TN-4',
          content: 'x', likes: [], comments: [], readBy: [],
          videos: [{ type: 'youtube', youtubeUrl: 'https://www.youtube.com/watch?v="><img src=x onerror=alert(1)>' }, { type: 'youtube', youtubeUrl: 'javascript:alert(1)//youtube.com' }] });
      });
      await page.evaluate(() => viewInternalPostDetail(990004));
      const html = await page.evaluate(() => document.getElementById('internalArticleContent').innerHTML);
      assert(!/<img[^>]*onerror|javascript:/i.test(html), `nội dung nguy hiểm lọt vào DOM: ${html}`);
      assert(!/<iframe/i.test(html), 'không nhúng iframe khi không tách được videoId hợp lệ');
      await page.evaluate(() => { closeInternalArticleModal(); DB.internalPosts = DB.internalPosts.filter(p => p.id !== 990004); });
    });

    await run('YouTube: SỬA bài nháp cũ (YouTube + video tải lên KHÔNG có type) -> nạp đúng loại, lưu lại giữ nguyên dữ liệu', async () => {
      await page.evaluate(() => {
        DB.internalPosts.push({ id: 990005, type: 'NEWS', status: 'DRAFT', author: 'admin1', title: 'Nháp YouTube', authorName: 'A', dept: 'D', createdAt: '1/1/2026', code: 'TN-5',
          contentFormat: 'html', content: '<p>nháp yt</p>', postCategory: 'HOAT_DONG_CHUNG',
          videos: [{ type: 'youtube', youtubeUrl: 'https://www.youtube.com/watch?v=abcDEF12345' }, { fileUrl: '/uploads/cu.mp4', fileName: 'cu.mp4' }], likes: [], comments: [], readBy: [] });
      });
      await page.evaluate(() => editInternalPostUI(990005));
      await page.waitForFunction(() => document.getElementById('internalContent').innerHTML.includes('nháp yt'));
      const d = await page.evaluate(() => ({ v: internalMediaDraft.videos.slice(), rows: [...document.querySelectorAll('#internalVideosPreview .internal-draft-video')].map(x => x.dataset.videoType), text: document.getElementById('internalVideosPreview').textContent }));
      assertEqual(JSON.stringify(d.rows), JSON.stringify(['youtube', 'upload']), 'preview đúng loại từng video');
      assert(d.text.includes('cu.mp4') && d.text.includes('abcDEF12345'), `preview hiện tên tệp/link: ${d.text}`);
      await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.__alerts.length = 0; });
      await page.evaluate(() => submitInternalPost({ preventDefault() {}, submitter: { id: 'internalDraftBtn' } }));
      const p = await page.evaluate(() => DB.internalPosts.find(x => x.id === 990005));
      assertEqual(JSON.stringify(p.videos), JSON.stringify([
        { type: 'youtube', youtubeUrl: 'https://www.youtube.com/watch?v=abcDEF12345' },
        { type: 'upload', fileUrl: '/uploads/cu.mp4', fileName: 'cu.mp4' }
      ]), `videos sau khi lưu lại (alerts: ${JSON.stringify(await page.evaluate(() => window.__alerts))})`);
    });

    // ===== Góc Chia Sẻ (SHARE, 10/2026): CHỈ cho nhúng link YouTube, KHÔNG cho tải file video lên =====
    await run('Góc Chia Sẻ (SHARE): ẩn nút "Tải video lên", tự chuyển sang chế độ Dán link YouTube', async () => {
      await page.evaluate(() => setInternalSubTab('SHARE'));
      const s = await page.evaluate(() => ({
        tabsHidden: document.getElementById('internalVideoModeTabs').classList.contains('hidden'),
        uploadHidden: document.getElementById('internalVideoUploadBox').classList.contains('hidden'),
        ytHidden: document.getElementById('internalVideoYoutubeBox').classList.contains('hidden')
      }));
      assert(s.tabsHidden, `phải ẩn nút chuyển chế độ ở tab SHARE: ${JSON.stringify(s)}`);
      assert(s.uploadHidden && !s.ytHidden, `phải tự mở sẵn ô Dán link YouTube ở tab SHARE: ${JSON.stringify(s)}`);
    });

    await run('Góc Chia Sẻ (SHARE): dán link YouTube vẫn thêm được bình thường dù nút chuyển chế độ đang ẩn', async () => {
      await page.fill('#internalYoutubeUrlInput', YT_URL);
      await page.click('[data-op="addInternalYoutubeVideo"]');
      await page.waitForFunction((url) => internalMediaDraft.videos.some(v => v.youtubeUrl === url), YT_URL);
    });

    await run('Đổi lại NEWS (Nhịp Sống HCRC): hiện lại nút "Tải video lên" như trước, không còn bị ẩn', async () => {
      await page.evaluate(() => setInternalSubTab('NEWS'));
      const s = await page.evaluate(() => ({
        tabsHidden: document.getElementById('internalVideoModeTabs').classList.contains('hidden'),
        uploadHidden: document.getElementById('internalVideoUploadBox').classList.contains('hidden')
      }));
      assert(!s.tabsHidden && !s.uploadHidden, `NEWS phải cho cả 2 cách như cũ: ${JSON.stringify(s)}`);
    });

    await run('Sửa lại bài SHARE cũ lỡ có video tải lên (dữ liệu TRƯỚC đợt siết) -> vẫn nạp/hiện đúng, không mất dữ liệu', async () => {
      await page.evaluate(() => {
        DB.internalPosts.push({ id: 990006, type: 'SHARE', status: 'DRAFT', author: 'admin1', title: 'Chia sẻ cũ có video tải lên', authorName: 'A', dept: 'D', createdAt: '1/1/2026', code: 'CS-6',
          content: 'nội dung cũ', postCategory: 'HOAT_DONG_CHUNG', videos: [{ fileUrl: '/uploads/cu-share.mp4', fileName: 'cu-share.mp4' }], likes: [], comments: [], readBy: [] });
      });
      await page.evaluate(() => editInternalPostUI(990006));
      const s = await page.evaluate(() => ({
        vids: internalMediaDraft.videos.length,
        tabsHidden: document.getElementById('internalVideoModeTabs').classList.contains('hidden'),
        rows: [...document.querySelectorAll('#internalVideosPreview .internal-draft-video')].map(x => x.dataset.videoType)
      }));
      assertEqual(s.vids, 1, 'video cũ phải được nạp lại vào bản nháp');
      assert(s.tabsHidden, 'vẫn ẩn nút chuyển chế độ dù bài cũ có video tải lên');
      assertEqual(JSON.stringify(s.rows), JSON.stringify(['upload']), 'preview vẫn hiện đúng video cũ (được phép giữ/xoá, chỉ chặn thêm MỚI)');
      await page.evaluate(() => cancelEditInternalPost());
    });

    // (Không quét cả #internalPostForm: core.js đặt el.style.order qua CSSOM — hợp lệ CSP, có từ trước —
    // nên innerHTML của form tự serialize ra style="order: 0;" không phải do HTML nội tuyến.)
    await run('không có on*=/style= nội tuyến trong HTML đã render (preview ảnh/video, feed, chi tiết)', async () => {
      await page.setInputFiles('#internalImagesInput', [{ name: 'x.png', mimeType: 'image/png', buffer: PNG }]);
      await page.setInputFiles('#internalVideosInput', [{ name: 'x.mp4', mimeType: 'video/mp4', buffer: MP4 }]);
      await waitUploads(1, 1);
      await page.evaluate(() => viewInternalPostDetail(DB.internalPosts.find(x => x.title === 'Bài có ảnh + video').id));
      const html = await page.evaluate(() => ['internalImagesPreview', 'internalVideosPreview', 'internalPostsContainer', 'internalArticleContent'].map(id => document.getElementById(id).innerHTML).join(''));
      assert(!/\son[a-z]+="/i.test(html), 'có on*= nội tuyến');
      assert(!/\sstyle="/i.test(html), 'có style= nội tuyến');
      await page.evaluate(() => closeInternalArticleModal());
    });

    assertEqual(pageErrors.length, 0, `unexpected page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
    summarize('test-internal-media-client.js');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
