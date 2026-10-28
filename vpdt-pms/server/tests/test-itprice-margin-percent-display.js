// server/tests/test-itprice-margin-percent-display.js
//
// Người dùng gửi ảnh chụp bảng xem trước (preview) khi tải file Excel lên Phê Duyệt Giá — cột "Margin
// bán lẻ" hiện "0.25205479452054796" thay vì "25.21%". Yêu cầu: "cột margin và chiết khấu phải là phần
// trăm hết... Đừng có chỉnh sửa thông tin file người ta up lên, file như nào thì để nguyên như vậy".
//
// Nguyên nhân: lib/priceFileParser.js chỉ tự nhân 100 khi Ô GỐC trong file Excel được chính người tải
// lên định dạng "%" — cột Margin/Chiết Khấu thường là kết quả công thức không được định dạng lại "%",
// nên bị đọc nguyên dạng phân số; itPriceCellHTML() (module-itsupport-price.js) trước đây hiển thị
// NGUYÊN VĂN giá trị đã đọc, không có bước định dạng % nào.
//
// Đã vá: formatItPriceCellValue()/isItPricePercentColumn() (module-itsupport-price.js) — CHỈ sửa cách
// HIỂN THỊ (áp dụng ngay trong itPriceCellHTML(), dùng cho cả 3 chỗ hiển thị: bảng xem trước trước khi
// xác nhận import, modal "Chi tiết" file viewer, bảng "So Sánh Thay Đổi"), KHÔNG đụng gì tới
// lib/priceFileParser.js/dữ liệu đã đọc/lưu từ file — đúng yêu cầu "file như nào thì để nguyên như
// vậy". Nhận diện cột theo NHÃN cột (do chính Mẫu Giá admin đặt tên) chứa "Margin"/"Chiết Khấu" nhưng
// LOẠI TRỪ "Hình Thức..." (cột phân loại kiểu "1"/"2", không phải số %, cũng xuất hiện trong ảnh chụp
// người dùng gửi — PHẢI giữ nguyên, không bị quy tắc % bắt nhầm).
//
// Chạy: node server/tests/test-itprice-margin-percent-display.js
'use strict';
const { startStaticServer, createMockState, launchPage, createRunner, assertEqual } = require('./testHarness');

const PORT = 8998;

async function main() {
  const run = createRunner();
  const server = await startStaticServer(PORT);
  const state = createMockState({});
  const { browser, page } = await launchPage(PORT, state);

  try {
    // Dữ liệu mô phỏng ĐÚNG ảnh chụp người dùng gửi: Margin bán lẻ dạng phân số (ô gốc KHÔNG định dạng
    // %), Giá bán lẻ là số tiền thường, Hình Thức Chiết Khấu là cột PHÂN LOẠI (giá trị "2" lặp lại).
    const FIXTURE = {
      columnLabels: [
        { key: 'c0', label: 'Giá bán lẻ (+VAT)' },
        { key: 'c1', label: 'Margin bán lẻ' },
        { key: 'c2', label: 'Hình thức Chiết Khấu' }
      ],
      items: [
        { values: { c0: '36500', c1: '0.25205479452054796', c2: '2' } },
        { values: { c0: '37000', c1: '0.20540540540540536', c2: '2' } },
        { values: { c0: '137000', c1: '0.195912408759124', c2: '2' } }
      ]
    };

    await run.run('renderItPriceFilePreview(): cột "Margin bán lẻ" hiện ĐÚNG dạng % làm tròn 2 số (không còn phân số dài)', async () => {
      const cells = await page.evaluate((data) => {
        document.getElementById('itPriceFilePreviewWrap')?.classList.remove('hidden');
        renderItPriceFilePreview(data);
        return [...document.querySelectorAll('#itPriceFilePreviewBody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent));
      }, FIXTURE);
      assertEqual(cells[0][1], '25.21%', 'Dòng 1: Margin bán lẻ phải là 25.21%');
      assertEqual(cells[1][1], '20.54%', 'Dòng 2: Margin bán lẻ phải là 20.54%');
      assertEqual(cells[2][1], '19.59%', 'Dòng 3: Margin bán lẻ phải là 19.59%');
    });

    await run.run('Cột "Giá bán lẻ (+VAT)" (không phải Margin/Chiết Khấu) KHÔNG bị đổi, vẫn hiện nguyên số tiền', async () => {
      const cells = await page.evaluate(() =>
        [...document.querySelectorAll('#itPriceFilePreviewBody tr')].map(tr => tr.querySelectorAll('td')[0].textContent)
      );
      assertEqual(JSON.stringify(cells), JSON.stringify(['36500', '37000', '137000']), 'Giá bán lẻ phải giữ NGUYÊN giá trị đã đọc từ file, không bị nhân/chia gì');
    });

    await run.run('LỖI ĐÃ TRÁNH: cột "Hình Thức Chiết Khấu" (phân loại, không phải %) KHÔNG bị quy tắc % bắt nhầm thành "2.00%"', async () => {
      const cells = await page.evaluate(() =>
        [...document.querySelectorAll('#itPriceFilePreviewBody tr')].map(tr => tr.querySelectorAll('td')[2].textContent)
      );
      assertEqual(JSON.stringify(cells), JSON.stringify(['2', '2', '2']), 'Hình Thức Chiết Khấu phải giữ nguyên "2", không bị thành "2.00%"');
    });

    await run.run('Cột "Chiết Khấu Bán Buôn" cũng được nhận diện đúng (không chỉ riêng "Margin")', async () => {
      const cell = await page.evaluate(() => formatItPriceCellValue({ label: 'Chiết Khấu Bán Buôn' }, '0.1870967741935483'));
      assertEqual(cell, '18.71%');
    });

    await run.run('Giá trị rỗng/không phải số vẫn an toàn (không crash, không hiện "NaN%")', async () => {
      const results = await page.evaluate(() => [
        formatItPriceCellValue({ label: 'Margin bán lẻ' }, ''),
        formatItPriceCellValue({ label: 'Margin bán lẻ' }, undefined),
        formatItPriceCellValue({ label: 'Margin bán lẻ' }, 'N/A')
      ]);
      assertEqual(JSON.stringify(results), JSON.stringify(['', '', 'N/A']), 'Rỗng/không phải số -> giữ nguyên, không hiện NaN%');
    });

    await run.run('Ô gốc file ĐÃ định dạng % (lib/priceFileParser.js đã nhân 100 sẵn, VD "25.205...") -> vẫn hiện đúng, KHÔNG nhân đúp lần nữa', async () => {
      const cell = await page.evaluate(() => formatItPriceCellValue({ label: 'Margin bán lẻ' }, '25.205479452054796'));
      assertEqual(cell, '25.21%', 'Giá trị đã ở dạng số % (>1) không được nhân thêm 100 lần nữa');
    });

    run.summary();
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error('FATAL:', (e && e.stack) || e);
  process.exitCode = 1;
});
