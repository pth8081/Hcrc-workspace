// server/tests/test-word-print-watermark.js
//
// Regression test TRÌNH DUYỆT THẬT (Playwright, _harness-contract.js) cho "🖨️ In có watermark" (file
// Word .docx) — LỖI ĐÃ VÁ (11/2026, người dùng báo tờ trình/hợp đồng cần in bị lệch/mất nội dung):
// cách CŨ (mammoth -> html2canvas chụp ảnh -> cắt theo chiều cao cố định -> ghép PDF bằng jsPDF) cắt
// ngang nội dung tùy tiện. Đã xác nhận với người dùng chuyển sang in TRỰC TIẾP qua window.print() của
// trình duyệt (chữ thật, ngắt trang theo CSS chuẩn), watermark là 1 dòng CHÂN TRANG cố định lặp lại mỗi
// trang in — xem printWordWithWatermark() (module-internalcomms-daotao-viewer.js) + #wordPrintArea
// (public/app.css).
//
// Dựng 1 file .docx THẬT bằng tay (qua "jszip" — DÙNG CHUNG đúng gói đã là dependency thật của dự án,
// KHÔNG thêm gói "docx" mới chỉ để phục vụ 1 test) để mammoth.js đọc/convert thật — không mock mammoth,
// xác nhận toàn bộ pipeline đọc file thật -> convert -> in hoạt động đúng. OOXML tối thiểu cần đủ
// [Content_Types].xml + _rels/.rels + word/document.xml là mammoth đọc được (đã verify tay qua node).
//
// Chạy: node server/tests/test-word-print-watermark.js
'use strict';
const { startHarness } = require('./_harness-contract');
const JSZip = require('jszip');

async function buildSampleDocxBase64() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>TỜ TRÌNH THỬ NGHIỆM</w:t></w:r></w:p>
    <w:p><w:r><w:t>Nội dung đoạn 1 - kiểm tra tiếng Việt có dấu đầy đủ.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Nội dung đoạn 2.</w:t></w:r></w:p>
  </w:body>
</w:document>`);
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  return buf.toString('base64');
}

async function main() {
  const h = await startHarness();
  const { page, loginAs, stop } = h;
  let failures = 0;
  const check = (label, cond) => {
    if (cond) { console.log(`PASS: ${label}`); } else { console.log(`FAIL: ${label}`); failures++; }
  };
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  try {
    const docxBase64 = await buildSampleDocxBase64();

    // Mock fetch(fileSrc) để trả về ĐÚNG byte thật của file .docx vừa dựng — KHÔNG mock mammoth.convertToHtml()
    // (chạy thật, xác nhận pipeline đọc file thật -> convert -> in hoạt động đúng, không chỉ giả lập).
    await page.exposeFunction('__getSampleDocxBase64', () => docxBase64);
    await page.evaluate(async () => {
      const b64 = await window.__getSampleDocxBase64();
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const originalFetch = window.fetch;
      window.fetch = async (url, opts) => {
        if (typeof url === 'string' && url === '/test-sample.docx') {
          return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer };
        }
        return originalFetch(url, opts);
      };
    });

    await loginAs('admin');

    // Mock window.print() — không thể/không nên để trình duyệt THẬT mở hộp thoại in OS trong CI.
    await page.evaluate(() => {
      window.__printCalls = 0;
      window.print = () => { window.__printCalls++; };
    });

    // Mô phỏng ĐÚNG trạng thái module-tailieu.js đã thiết lập trước khi hiện nút "🖨️ In có watermark"
    // (xem openFileProtectedView() kind==='word') — không cần dựng lại cả luồng mở 1 tài liệu thật.
    await page.evaluate(() => {
      currentWordPrintFile = { fileSrc: '/test-sample.docx', fileName: 'To_trinh_thu_nghiem.docx' };
    });

    check('Trước khi in: #wordPrintArea chưa tồn tại', await page.evaluate(() => !document.getElementById('wordPrintArea')));
    check('Trước khi in: body chưa có class word-printing', await page.evaluate(() => !document.body.classList.contains('word-printing')));

    await page.evaluate(() => window.printWordWithWatermark());
    await page.waitForFunction(() => window.__printCalls > 0, { timeout: 10000 });

    check('window.print() được gọi đúng 1 lần', await page.evaluate(() => window.__printCalls === 1));
    check('#wordPrintArea được tạo, chứa nội dung mammoth convert được (tiếng Việt có dấu)',
      await page.evaluate(() => (document.getElementById('wordPrintArea')?.textContent || '').includes('TỜ TRÌNH THỬ NGHIỆM')));
    check('#wordPrintArea có đúng 1 watermark chân trang (word-print-watermark), đúng nội dung công ty',
      await page.evaluate(() => {
        const wm = document.querySelectorAll('#wordPrintArea .word-print-watermark');
        return wm.length === 1 && /HCRC/.test(wm[0].textContent);
      }));
    check('body có class word-printing khi đang in (để @media print ẩn phần còn lại của trang)',
      await page.evaluate(() => document.body.classList.contains('word-printing')));
    check('Không có script độc hại lọt qua DOMPurify (chỉ có text/định dạng cơ bản, không có <script>)',
      await page.evaluate(() => document.querySelectorAll('#wordPrintArea script').length === 0));

    // Bắn 'afterprint' thật (window.print() giả không tự bắn sự kiện này) — xác nhận cleanup() dọn đúng.
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.waitForTimeout(100);
    check('Sau afterprint: #wordPrintArea bị gỡ khỏi DOM', await page.evaluate(() => !document.getElementById('wordPrintArea')));
    check('Sau afterprint: body gỡ class word-printing', await page.evaluate(() => !document.body.classList.contains('word-printing')));

    // Gọi lại lần 2 (xác nhận không có trạng thái cũ sót lại gây lỗi/trùng lặp #wordPrintArea).
    await page.evaluate(() => { window.__printCalls = 0; });
    await page.evaluate(() => window.printWordWithWatermark());
    await page.waitForFunction(() => window.__printCalls > 0, { timeout: 10000 });
    check('Gọi lại lần 2: vẫn hoạt động đúng, không trùng lặp #wordPrintArea',
      await page.evaluate(() => document.querySelectorAll('#wordPrintArea').length === 1));
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

    check('Không có ngoại lệ JS chưa bắt (pageerror) nào phát sinh', pageErrors.length === 0);
    if (pageErrors.length) console.error('  pageerror:', pageErrors.join(' | '));
  } finally {
    await stop();
  }

  console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
  if (failures > 0) process.exitCode = 1;
}

main().catch(err => { console.error('FATAL:', err && err.stack || err); process.exitCode = 1; });
