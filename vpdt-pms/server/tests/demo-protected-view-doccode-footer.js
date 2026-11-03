// server/tests/demo-protected-view-doccode-footer.js
//
// DEMO ĐỀ XUẤT (CHƯA sửa code thật) — người dùng gửi ảnh chụp Khung Xem Bảo Vệ (Protected View) hợp đồng,
// hỏi: "ở chỗ chân thêm mã của tài liệu, các module có tài liệu đề sẽ hiển thị thêm mã tài liệu nối tiếp
// dòng Hệ thống văn phòng số Công ty HCRC". Script này KHÔNG đổi bất kỳ file nguồn nào — chỉ gọi
// window.renderPdfProtected() (hàm THẬT, public/js/core.js) 2 lần trên cùng khung xem: lần 1 với chuỗi
// watermark HIỆN TẠI (chỉ tên hệ thống), lần 2 với chuỗi ĐỀ XUẤT (nối thêm mã tài liệu) — để chụp ảnh
// trước/sau cho người dùng xác nhận phương án trước khi code thật.
//
// Chạy: node server/tests/demo-protected-view-doccode-footer.js
'use strict';

const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const { startStaticServer, createMockState, launchPage } = require('./testHarness');

const PORT = 8999;
const OUT_DIR = process.env.DEMO_OUT_DIR || path.join(__dirname, '..', 'demo-screenshots', 'protected-view-doccode-footer');

const USER = { username: 'demo_user', name: 'Người Dùng Demo', dept: 'Vận Hành', perms: {}, active: true };

async function shot(page, selector, file) {
  await page.locator(selector).screenshot({ path: path.join(OUT_DIR, file) });
  console.log('📸', file);
}
async function loginAs(page, user) {
  await page.evaluate(async (u) => { window.__resetCapture(); await proceedAfterAuth(u); }, user);
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1 trang PDF đơn giản để demo (nội dung không quan trọng — chỉ cần xem được footer đè lên dưới).
  const pdfDoc = await PDFDocument.create();
  const p = pdfDoc.addPage([595, 300]);
  p.drawText('HOP DONG DICH VU BAO TRI HE THONG (ban demo)', { x: 40, y: 230, size: 14 });
  p.drawText('(Noi dung minh hoa - chi dung de demo vi tri footer)', { x: 40, y: 200, size: 10 });
  const pdfBytes = await pdfDoc.save();
  const dataUrl = `data:application/pdf;base64,${Buffer.from(pdfBytes).toString('base64')}`;

  const state = createMockState({ depts: ['Vận Hành'], users: [USER] });
  const server = await startStaticServer(PORT);
  const { browser, page } = await launchPage(PORT, state);

  try {
    await loginAs(page, USER);

    // Mở Khung Xem Bảo Vệ qua ĐÚNG hàm thật dùng chung toàn hệ thống (openFileProtectedView), y hệt
    // cách module Hợp Đồng/Tài Liệu/Văn Bản Trình... đang mở khi người dùng bấm "👁️ Xem".
    await page.evaluate((src) => {
      openFileProtectedView({
        title: '📄 HCRC-HD-2026-00042 — Hợp Đồng Dịch Vụ Bảo Trì Hệ Thống',
        sub: 'Vận Hành | Người Dùng Demo | 03/11/2026',
        fileSrc: src, fileType: 'pdf', fileName: 'hop-dong-demo.pdf'
      });
    }, dataUrl);
    await page.waitForTimeout(600);
    await shot(page, '#viewDocModal', '1-HIEN-TAI-chi-ten-he-thong.png');

    // Gọi LẠI renderPdfProtected() THẬT trên cùng khung xem, chỉ đổi watermarkText thành chuỗi ĐỀ XUẤT
    // (nối thêm mã tài liệu ngay sau dòng tên hệ thống) — chứng minh đúng hàm thật sẽ vẽ ra sao, không
    // phải dựng HTML giả lập riêng.
    await page.evaluate((src) => {
      const pdfContainer = document.querySelector('#viewModalContent .protected-view-container');
      window.renderPdfProtected(pdfContainer, src, 'Hệ thống văn phòng số Công ty HCRC — Mã: HCRC-HD-2026-00042', null);
    }, dataUrl);
    await page.waitForTimeout(600);
    await shot(page, '#viewDocModal', '2-DE-XUAT-noi-them-ma-tai-lieu.png');

    console.log('\n✅ Demo xong (CHƯA sửa code thật) — ảnh lưu tại', OUT_DIR);
  } finally {
    await browser.close();
    server.close();
  }
})();
