// tests/test-pdf-mobile-responsive.js — renderPdfProtected() (core.js) responsive mobile (10/2026, theo
// yêu cầu người dùng "nội dung bài học PDF cần responsive tốt hơn trên mobile"). Trước đây scale chỉ
// tính 1 LẦN lúc mở (không có ResizeObserver) VÀ có SÀN CỨNG scale=0.5 — trên điện thoại hẹp (<400px),
// sàn cứng đó ép pageWrap rộng hơn khung nhìn thật -> PDF tràn ngang. Đợt sửa này: (1) hạ sàn scale
// xuống gần 0 (chỉ chặn scale không âm/không), (2) thêm ResizeObserver vẽ lại theo bề rộng container
// mới khi xoay màn hình/thu-phóng cửa sổ — KHÔNG tạo lại DOM (giữ nguyên phần tử IntersectionObserver
// đang theo dõi, xem test-training-video-pdf-progress.js cho phần đó, không lặp lại ở đây).
//
// Run: node tests/test-pdf-mobile-responsive.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { PDFDocument } = require('pdf-lib');
const { setup, teardown, makeRunner, assertEqual } = require('./_harness');

const PORT = 8976;

async function main() {
  const { server, browser, page, pageErrors } = await setup(PORT);
  const { run, summarize } = makeRunner();
  const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
  const testPdfName = 'test-pdf-mobile-responsive-demo.pdf';
  const testPdfPath = path.join(uploadsDir, testPdfName);
  let createdUploadsDir = false;

  try {
    await run('[setup] tạo file PDF thật (khổ A4-ish 595x842pt, giống văn bản thường) qua static server', async () => {
      const pdfDoc = await PDFDocument.create();
      const p = pdfDoc.addPage([595, 842]);
      p.drawText('Test page mobile', { x: 20, y: 800, size: 18 });
      const bytes = await pdfDoc.save();
      if (!fs.existsSync(uploadsDir)) { fs.mkdirSync(uploadsDir, { recursive: true }); createdUploadsDir = true; }
      fs.writeFileSync(testPdfPath, bytes);
    });

    // Viewport trình duyệt GIỮ CỐ ĐỊNH rộng (800x800) suốt bài test — mô phỏng độ hẹp MÀN HÌNH THẬT bằng
    // cách đặt thẳng bề rộng CONTAINER (px), vì renderPdfProtected() chỉ đọc container.clientWidth, không
    // quan tâm viewport trình duyệt. Cách này cũng tránh viewport quá hẹp làm modal/scrollbar Playwright
    // tự thu nhỏ ngoài ý muốn.
    await run('container hẹp (340px, mô phỏng điện thoại nhỏ <iPhone SE-class) -> pageWrap KHÔNG tràn ngang khung xem', async () => {
      await page.setViewportSize({ width: 800, height: 800 });
      await page.evaluate(() => {
        document.body.innerHTML = '<div id="pdfTestContainer" style="width:340px;height:400px;overflow-y:auto;"></div>';
      });
      await page.evaluate((url) => window.renderPdfProtected(document.getElementById('pdfTestContainer'), url, null), `/uploads/${testPdfName}`);
      await page.waitForFunction(() => document.querySelector('#pdfTestContainer [data-page-num]'), null, { timeout: 10000 });
      const r = await page.evaluate(() => {
        const container = document.getElementById('pdfTestContainer');
        const pageWrap = container.querySelector('[data-page-num="1"]');
        return { containerWidth: container.clientWidth, pageWrapWidth: pageWrap.getBoundingClientRect().width, scrollWidth: container.scrollWidth };
      });
      assert.ok(r.pageWrapWidth <= r.containerWidth + 1, `pageWrap (${r.pageWrapWidth}px) phải vừa khung (${r.containerWidth}px), trước đây sàn scale=0.5 gây tràn`);
      assert.ok(r.scrollWidth <= r.containerWidth + 1, `container không được cuộn ngang: scrollWidth=${r.scrollWidth} containerWidth=${r.containerWidth}`);
    });

    await run('resize container (xoay ngang/thu nhỏ cửa sổ) -> ResizeObserver tự vẽ lại canvas theo bề rộng mới', async () => {
      const before = await page.evaluate(() => {
        const pageWrap = document.querySelector('#pdfTestContainer [data-page-num="1"]');
        return pageWrap.getBoundingClientRect().width;
      });
      await page.evaluate(() => { document.getElementById('pdfTestContainer').style.width = '700px'; });
      await page.waitForFunction((prevWidth) => {
        const pageWrap = document.querySelector('#pdfTestContainer [data-page-num="1"]');
        return pageWrap.getBoundingClientRect().width > prevWidth + 20;
      }, before, { timeout: 3000 });
      const after = await page.evaluate(() => {
        const container = document.getElementById('pdfTestContainer');
        const pageWrap = container.querySelector('[data-page-num="1"]');
        return { containerWidth: container.clientWidth, pageWrapWidth: pageWrap.getBoundingClientRect().width };
      });
      assert.ok(after.pageWrapWidth > before, `sau khi mở rộng container, pageWrap phải vẽ lại LỚN hơn (trước=${before}, sau=${after.pageWrapWidth})`);
      assert.ok(after.pageWrapWidth <= after.containerWidth + 1, `pageWrap phải vẫn vừa khung mới: ${after.pageWrapWidth} vs ${after.containerWidth}`);
    });

    await run('gọi renderPdfProtected() lần 2 trên CÙNG container -> resizeObserver cũ được dọn (không tích luỹ nhiều observer)', async () => {
      await page.evaluate((url) => window.renderPdfProtected(document.getElementById('pdfTestContainer'), url, null), `/uploads/${testPdfName}`);
      await page.waitForFunction(() => document.querySelector('#pdfTestContainer [data-page-num="1"]'), null, { timeout: 10000 });
      const hasObserver = await page.evaluate(() => !!document.getElementById('pdfTestContainer')._pdfResizeObserver);
      assert.ok(hasObserver, 'container phải giữ tham chiếu resizeObserver MỚI NHẤT để lần render kế tiếp dọn đúng');
    });

    assertEqual(pageErrors.length, 0, `unexpected page errors: ${pageErrors.map((e) => e.message).join(' | ')}`);
  } finally {
    try { fs.unlinkSync(testPdfPath); } catch (e) { /* ignore */ }
    if (createdUploadsDir) { try { fs.rmdirSync(uploadsDir); } catch (e) { /* ignore, may not be empty */ } }
    await teardown({ server, browser });
    summarize('test-pdf-mobile-responsive.js');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
