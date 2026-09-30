// tests/test-training-course-card-thumbnail.js — Đào Tạo > Chương Trình (10/2026, theo yêu cầu người
// dùng "Danh sách chương trình thì bổ sung thumbnail cho các chương trình"): đổi #trainingCoursesTableBody
// (bảng) sang #trainingCoursesContainer (dạng thẻ, cùng khuôn #recruitmentJobsContainer) + field
// thumbnailUrl/thumbnailFileName (upload qua moduleKey 'internalImage', mirror rjBannerFile).
//
// Run: node tests/test-training-course-card-thumbnail.js
const { setup, teardown, makeRunner, assert, assertEqual, baseCatalogSeed, makeUser } = require('./_harness');

function fakeFile(name, content, mime) {
  return { name, mimeType: mime, buffer: Buffer.from(content) };
}

const PORT = 8977;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();
  try {
    const trainer = makeUser({ username: 'gv.linh', name: 'Trần Thị Linh', dept: 'Phòng Nhân Sự', perms: { trainingManage: true } });
    const staff = makeUser({ username: 'nv1', name: 'Nhân Viên', dept: 'Phòng Kế Toán', perms: {} });
    await page.evaluate((seed) => { Object.assign(DB, seed); }, baseCatalogSeed());
    await page.evaluate(([a, b]) => {
      DB.users = [a, b];
      DB.trainingCourses = [
        { id: 501, name: 'Chương trình An Toàn Lao Động', category: 'Nghiệp vụ', description: 'Mô tả ATLĐ', creator: 'gv.linh', creatorName: 'Trần Thị Linh', thumbnailUrl: '/uploads/atld.png', thumbnailFileName: 'atld.png' },
        { id: 502, name: 'Chương trình Kỹ Năng Mềm', category: 'Kỹ năng', description: '', creator: 'gv.linh', creatorName: 'Trần Thị Linh' }
      ];
    }, [trainer, staff]);
    await page.evaluate((u) => finishLogin(u), trainer);
    await page.evaluate(() => { switchTab('internal'); setInternalSubTab('TRAINING'); setTrainingLmsTab('COURSES'); });

    await run('Danh sách Chương Trình dùng #trainingCoursesContainer dạng THẺ (không còn bảng cũ)', async () => {
      const r = await page.evaluate(() => ({
        hasContainer: !!document.getElementById('trainingCoursesContainer'),
        hasOldTable: !!document.getElementById('trainingCoursesTableBody'),
        cardCount: document.querySelectorAll('#trainingCoursesContainer [data-course-id]').length
      }));
      assert(r.hasContainer, 'phải có #trainingCoursesContainer');
      assert(!r.hasOldTable, 'bảng cũ #trainingCoursesTableBody phải KHÔNG còn tồn tại');
      assertEqual(r.cardCount, 2, 'phải hiện đủ 2 thẻ chương trình');
    });

    await run('Thẻ CÓ thumbnail: ảnh object-contain đúng src; thẻ KHÔNG có thumbnail: placeholder icon', async () => {
      const r = await page.evaluate(() => {
        const withThumb = document.querySelector('[data-course-id="501"]');
        const noThumb = document.querySelector('[data-course-id="502"]');
        const img = withThumb.querySelector('img');
        return {
          imgSrc: img && img.getAttribute('src'),
          imgClass: img && img.className,
          placeholderText: noThumb.textContent.includes('🎓'),
          noImgOnPlaceholder: !noThumb.querySelector('img')
        };
      });
      assertEqual(r.imgSrc, '/uploads/atld.png', 'nguồn ảnh thumbnail');
      assert(r.imgClass.includes('object-contain'), `ảnh phải object-contain: ${r.imgClass}`);
      assert(r.placeholderText, 'không có thumbnail phải hiện icon placeholder 🎓');
      assert(r.noImgOnPlaceholder, 'không có thumbnail thì không được có thẻ <img>');
    });

    await run('Tạo chương trình mới có ảnh minh hoạ -> upload qua uploadFileToServer(internalImage), lưu thumbnailUrl/thumbnailFileName', async () => {
      await page.evaluate(() => {
        document.getElementById('tccCategory').value = 'Nghiệp vụ';
        document.getElementById('tccName').value = 'Chương trình Giao Tiếp';
        document.getElementById('tccDescription').value = 'Mô tả giao tiếp';
      });
      await page.setInputFiles('#tccThumbnailFile', fakeFile('thumb-new.png', 'noi dung', 'image/png'));
      const calls = await page.evaluate(async () => {
        window.__uploadCalls = [];
        const origUpload = window.uploadFileToServer;
        window.uploadFileToServer = async (file, moduleKey) => {
          window.__uploadCalls.push({ name: file.name, moduleKey });
          return { fileUrl: '/uploads/new-thumb.png', fileName: 'new-thumb.png' };
        };
        await submitTrainingCourse({ preventDefault() {} });
        window.uploadFileToServer = origUpload;
        return window.__uploadCalls;
      });
      assertEqual(calls.length, 1, 'phải gọi upload đúng 1 lần');
      assertEqual(calls[0].moduleKey, 'internalImage', 'moduleKey phải là internalImage (cùng banner tuyển dụng)');
      const course = await page.evaluate(() => DB.trainingCourses.find(c => c.name === 'Chương trình Giao Tiếp'));
      assert(course, 'chương trình phải được tạo');
      assertEqual(course.thumbnailUrl, '/uploads/new-thumb.png', 'thumbnailUrl');
      assertEqual(course.thumbnailFileName, 'new-thumb.png', 'thumbnailFileName');
      const cardHTML = await page.evaluate((id) => document.querySelector(`[data-course-id="${id}"]`).innerHTML, course.id);
      assert(cardHTML.includes('/uploads/new-thumb.png'), 'thẻ mới phải hiện ảnh vừa upload');
    });

    await run('Sửa chương trình KHÔNG chọn ảnh mới -> giữ nguyên thumbnail cũ (không xoá)', async () => {
      await page.evaluate((id) => editTrainingCourse(id), 501);
      await page.evaluate(() => { document.getElementById('tccDescription').value = 'Mô tả ATLĐ đã sửa'; });
      await page.evaluate(() => submitTrainingCourse({ preventDefault() {} }));
      const course = await page.evaluate(() => DB.trainingCourses.find(c => c.id === 501));
      assertEqual(course.thumbnailUrl, '/uploads/atld.png', 'thumbnailUrl phải giữ nguyên');
      assertEqual(course.description, 'Mô tả ATLĐ đã sửa', 'mô tả phải cập nhật');
    });

    await run('Biểu Mẫu: CORE_FIELD_MANIFEST.TRAINING_COURSE có tccThumbnailFile', async () => {
      const ok = await page.evaluate(() => CORE_FIELD_MANIFEST.TRAINING_COURSE.some(f => f.id === 'tccThumbnailFile'));
      assert(ok, 'thiếu tccThumbnailFile trong manifest');
    });

    await run('không có on*=/style= nội tuyến trong danh sách thẻ chương trình', async () => {
      const html = await page.evaluate(() => document.getElementById('trainingCoursesContainer').innerHTML);
      assert(!/\son[a-z]+="/i.test(html), 'on*= nội tuyến');
      assert(!/\sstyle="/i.test(html), 'style= nội tuyến');
    });

    assertEqual(pageErrors.length, 0, `unexpected page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    await teardown({ server, browser });
    summarize('test-training-course-card-thumbnail.js');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
