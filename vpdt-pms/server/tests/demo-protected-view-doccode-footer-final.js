// server/tests/demo-protected-view-doccode-footer-final.js
//
// Demo XÁC NHẬN CUỐI (v28.86) — khác demo-protected-view-doccode-footer.js (gọi tay watermarkText để đề
// xuất phương án trước khi code thật), script này gọi ĐÚNG hàm viewDoc() thật của module Tài Liệu trên 1
// bản ghi DB.docs thật có mã hồ sơ — chứng minh toàn bộ đường đi production (viewDoc -> openFileProtectedView
// -> buildProtectedViewWatermarkText -> renderPdfProtected) hoạt động đúng, không qua bất kỳ override nào.
//
// Chạy: node server/tests/demo-protected-view-doccode-footer-final.js
'use strict';
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8992;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'protected-view-doccode-footer-final');
const USER = { username: 'demo_user', name: 'Người Dùng Demo', dept: 'Vận Hành', perms: { docManage: true }, active: true };

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}
async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const pdfDoc = await PDFDocument.create();
  const p = pdfDoc.addPage([595, 300]);
  p.drawText('QUY TRINH VAN HANH KHO (ban demo)', { x: 40, y: 230, size: 14 });
  const pdfBytes = await pdfDoc.save();
  const dataUrl = `data:application/pdf;base64,${Buffer.from(pdfBytes).toString('base64')}`;

  const DOC = {
    id: 1, code: 'HCRC-TL-2026-00017', title: 'Quy Trình Vận Hành Kho', dept: 'Vận Hành', cat: 'Quy Trình',
    ver: 1, uploaderName: 'Người Dùng Demo', uploader: 'demo_user', summary: 'Tài liệu demo',
    fileUrl: dataUrl, fileType: 'pdf', fileName: 'quy-trinh-kho.pdf', status: 'ACTIVE'
  };

  const state = createMockState({ depts: ['Vận Hành'], users: [USER], docs: [DOC] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    await loginAs(page, USER);
    await page.evaluate((docId) => { viewDoc(docId); }, DOC.id);
    await page.waitForTimeout(700);
    await shot(page, '#viewDocModal', 'viewDoc-that-noi-dung-ma-ho-so.png');

    // renderPdfProtected() (core.js) gán watermark qua wm.style.cssText trực tiếp bằng JS (không phải
    // thuộc tính HTML data-style) nên dò theo style.position === 'absolute' thay vì chọn selector CSS.
    const footerText = await page.evaluate(() => {
      const divs = Array.from(document.querySelectorAll('#viewModalContent div'));
      const wm = divs.find(d => d.style && d.style.position === 'absolute' && d.textContent.includes('Hệ thống văn phòng số'));
      return wm ? wm.textContent : null;
    });
    console.log('Watermark thật đọc được từ DOM:', footerText);
    if (!footerText || !footerText.includes(DOC.code)) {
      throw new Error('❌ Watermark KHÔNG chứa mã hồ sơ — viewDoc() thật chưa hoạt động đúng!');
    }
    console.log('\n✅ XÁC NHẬN: viewDoc() THẬT (production code, không override) đã nối đúng mã hồ sơ vào watermark.');
  } finally {
    await browser.close();
    server.close();
  }
})();
